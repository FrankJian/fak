//! 更新通道探测（SPEC §12.3.2）。
//!
//! 只做「测试连接」：请求更新清单并报告状态码与耗时，**不下载安装包**。
//! 用户点这个按钮是想确认代理通不通，不是想先下几十 MB。
//!
//! 代理串可能带账号密码，因此：
//! - 不写进日志（AGENTS.md §9.2），只记 `configured` / `none`；
//! - 不进错误负载，`UpdateCheckFailed.detail` 只放归类后的短语。

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::error::{AppError, AppResult};

/// 探测超时。比常规请求宽松：走代理时握手本来就慢，
/// 卡在这里比误报「不通」要好。
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProbe {
    pub status: u16,
    pub elapsed_ms: u64,
}

/// 把 reqwest 的错误归类成不含代理串、不含完整 URL 的短语。
fn classify(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "timeout".to_owned()
    } else if error.is_connect() {
        "connect".to_owned()
    } else if error.is_request() {
        "request".to_owned()
    } else {
        "other".to_owned()
    }
}

fn build_client(proxy: &str) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder().timeout(PROBE_TIMEOUT);
    let trimmed = proxy.trim();
    if trimmed.is_empty() {
        // 空串走系统代理（reqwest 默认行为），这正是「忽略系统代理」关闭时想要的
    } else {
        let proxy = reqwest::Proxy::all(trimmed).map_err(|_| AppError::UpdateCheckFailed {
            detail: "proxy".to_owned(),
        })?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|error| AppError::UpdateCheckFailed {
            detail: classify(&error),
        })
}

/// 从 updater 插件配置里取第一个清单地址，而不是再定义一份——
/// 两处地址一旦不一致，「测试连接」就在骗人。
fn manifest_url<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let updater = app.config().plugins.0.get("updater")?;
    let endpoint = updater.get("endpoints")?.as_array()?.first()?.as_str()?;
    Some(endpoint.to_owned())
}

#[tauri::command]
pub async fn test_update_endpoint<R: Runtime>(
    app: AppHandle<R>,
    proxy: String,
) -> AppResult<UpdateProbe> {
    let url = manifest_url(&app).ok_or(AppError::UpdateChannelUnconfigured)?;

    log::info!("probing update endpoint (proxy {})", describe_proxy(&proxy));

    let client = build_client(&proxy)?;
    let started = Instant::now();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| AppError::UpdateCheckFailed {
            detail: classify(&error),
        })?;

    Ok(UpdateProbe {
        status: response.status().as_u16(),
        elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

/// 日志里只允许出现这个，绝不能是代理串本身（AGENTS.md §9.2）。
pub fn describe_proxy(proxy: &str) -> &'static str {
    if proxy.trim().is_empty() {
        "none"
    } else {
        "configured"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Read, Write};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    fn read_exact(stream: &mut TcpStream, length: usize) -> io::Result<Vec<u8>> {
        let mut bytes = vec![0; length];
        stream.read_exact(&mut bytes)?;
        Ok(bytes)
    }

    fn serve_socks_connection(mut client: TcpStream) -> io::Result<()> {
        let hello = read_exact(&mut client, 2)?;
        if hello[0] != 5 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not socks5"));
        }
        let _methods = read_exact(&mut client, hello[1] as usize)?;
        client.write_all(&[5, 0])?;

        let request = read_exact(&mut client, 4)?;
        if request[0] != 5 || request[1] != 1 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not connect"));
        }
        let host = match request[3] {
            1 => {
                let bytes = read_exact(&mut client, 4)?;
                IpAddr::V4(Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3]))
            }
            4 => {
                let bytes: [u8; 16] = read_exact(&mut client, 16)?
                    .try_into()
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "ipv6"))?;
                IpAddr::V6(Ipv6Addr::from(bytes))
            }
            _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "address type")),
        };
        let port = u16::from_be_bytes(
            read_exact(&mut client, 2)?
                .try_into()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "port"))?,
        );
        let mut upstream = TcpStream::connect(SocketAddr::new(host, port))?;
        client.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0])?;

        let mut client_reader = client.try_clone()?;
        let mut upstream_writer = upstream.try_clone()?;
        let upload = thread::spawn(move || io::copy(&mut client_reader, &mut upstream_writer));
        io::copy(&mut upstream, &mut client)?;
        let _ = upload.join();
        Ok(())
    }

    fn start_socks_server() -> (SocketAddr, mpsc::Receiver<io::Result<()>>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("绑定 SOCKS 测试服务");
        let address = listener.local_addr().expect("SOCKS 地址");
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let result = listener
                .accept()
                .map(|(client, _)| client)
                .and_then(serve_socks_connection);
            let _ = sender.send(result);
        });
        (address, receiver)
    }

    fn start_http_server() -> SocketAddr {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("绑定 HTTP 测试服务");
        let address = listener.local_addr().expect("HTTP 地址");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("接收 HTTP 请求");
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("返回 HTTP 响应");
        });
        address
    }

    fn assert_socks_prefix_connects(prefix: &str) {
        let target = start_http_server();
        let (proxy, completed) = start_socks_server();
        let client = build_client(&format!("{prefix}://{proxy}")).expect("构建 SOCKS 客户端");
        let status = tauri::async_runtime::block_on(async {
            client
                .get(format!("http://{target}/manifest"))
                .send()
                .await
                .expect("经 SOCKS 代理连接本地服务")
                .status()
        });
        assert_eq!(status.as_u16(), 204);
        completed
            .recv_timeout(Duration::from_secs(2))
            .expect("SOCKS 服务应结束")
            .expect("SOCKS 转发应成功");
    }

    #[test]
    fn 日志描述不回显代理串() {
        assert_eq!(describe_proxy("http://user:secret@host:8080"), "configured");
        assert_eq!(describe_proxy(""), "none");
        assert_eq!(describe_proxy("   "), "none");
    }

    #[test]
    fn 非法代理串构建客户端失败且错误里没有代理串() {
        let error = build_client("not a proxy at all ://").unwrap_err();
        match error {
            AppError::UpdateCheckFailed { detail } => {
                assert_eq!(detail, "proxy");
                assert!(!detail.contains("proxy at all"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn 空代理串构建成功走系统代理() {
        assert!(build_client("").is_ok());
        assert!(build_client("http://127.0.0.1:8080").is_ok());
    }

    #[test]
    fn socks5_前缀可以实际连接() {
        assert_socks_prefix_connects("socks5");
    }

    #[test]
    fn socks5h_前缀可以实际连接() {
        assert_socks_prefix_connects("socks5h");
    }
}
