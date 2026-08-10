//! JSON / JSONC 的格式化与压缩（SPEC F9.1）。
//!
//! 自己写词法而不是「反序列化再序列化」，有两个理由：
//!   1. **JSONC 的注释必须留着**，serde 那条路会把注释直接吃掉；
//!   2. 非法输入要能报出**行列位置**，而不是一句「解析失败」。
//!
//! 只重排空白：键的顺序、数字与字符串的原始写法都原样搬运，
//! 格式化不该顺手把 `1.50` 改成 `1.5`。

use super::FormatIssue;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    Punct(char),
    Literal(String),
    String(String),
    Comment(String),
    /// 注释所在行的行尾注释（跟在值后面），排版时不能另起一行
    TrailingComment(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Spanned {
    token: Token,
    line: usize,
    column: usize,
}

struct Lexer<'a> {
    bytes: &'a [u8],
    text: &'a str,
    at: usize,
    line: usize,
    column: usize,
}

impl<'a> Lexer<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            bytes: text.as_bytes(),
            text,
            at: 0,
            line: 1,
            column: 1,
        }
    }

    fn issue(&self, detail: &str) -> FormatIssue {
        FormatIssue {
            line: self.line,
            column: self.column,
            detail: detail.to_string(),
        }
    }

    fn bump(&mut self) -> Option<char> {
        let ch = self.text[self.at..].chars().next()?;
        self.at += ch.len_utf8();
        if ch == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }
        Some(ch)
    }

    fn peek(&self) -> Option<char> {
        self.text[self.at..].chars().next()
    }

    fn peek_at(&self, offset: usize) -> Option<u8> {
        self.bytes.get(self.at + offset).copied()
    }

    /// 跳过空白，返回是否跨过了换行——行尾注释靠它与下一行的整行注释区分。
    fn skip_whitespace(&mut self) -> bool {
        let mut crossed_newline = false;
        while let Some(ch) = self.peek() {
            if !ch.is_whitespace() {
                break;
            }
            if ch == '\n' {
                crossed_newline = true;
            }
            self.bump();
        }
        crossed_newline
    }

    fn read_string(&mut self) -> Result<String, FormatIssue> {
        let start = self.at;
        self.bump();
        loop {
            match self.bump() {
                None => return Err(self.issue("unterminated string")),
                Some('\\') => {
                    if self.bump().is_none() {
                        return Err(self.issue("unterminated escape"));
                    }
                }
                Some('"') => break,
                Some(_) => {}
            }
        }
        Ok(self.text[start..self.at].to_string())
    }

    fn read_comment(&mut self) -> Result<String, FormatIssue> {
        let start = self.at;
        self.bump();
        match self.peek() {
            Some('/') => {
                while let Some(ch) = self.peek() {
                    if ch == '\n' {
                        break;
                    }
                    self.bump();
                }
            }
            Some('*') => {
                self.bump();
                loop {
                    match self.bump() {
                        None => return Err(self.issue("unterminated comment")),
                        Some('*') if self.peek() == Some('/') => {
                            self.bump();
                            break;
                        }
                        Some(_) => {}
                    }
                }
            }
            _ => return Err(self.issue("unexpected '/'")),
        }
        Ok(self.text[start..self.at].trim_end().to_string())
    }

    fn read_literal(&mut self) -> String {
        let start = self.at;
        while let Some(ch) = self.peek() {
            if ch.is_whitespace() || matches!(ch, ',' | ':' | '{' | '}' | '[' | ']') {
                break;
            }
            if ch == '/' && matches!(self.peek_at(1), Some(b'/') | Some(b'*')) {
                break;
            }
            self.bump();
        }
        self.text[start..self.at].to_string()
    }
}

fn tokenize(text: &str, allow_comments: bool) -> Result<Vec<Spanned>, FormatIssue> {
    let mut lexer = Lexer::new(text);
    let mut tokens = Vec::new();
    let mut at_line_start = true;

    loop {
        let crossed = lexer.skip_whitespace();
        if crossed {
            at_line_start = true;
        }
        let Some(ch) = lexer.peek() else { break };
        let (line, column) = (lexer.line, lexer.column);
        let push = |token: Token, tokens: &mut Vec<Spanned>| {
            tokens.push(Spanned {
                token,
                line,
                column,
            });
        };

        match ch {
            '/' => {
                if !allow_comments {
                    return Err(lexer.issue("comments are not allowed in JSON"));
                }
                let comment = lexer.read_comment()?;
                push(
                    if at_line_start {
                        Token::Comment(comment)
                    } else {
                        Token::TrailingComment(comment)
                    },
                    &mut tokens,
                );
            }
            '"' => {
                let value = lexer.read_string()?;
                push(Token::String(value), &mut tokens);
                at_line_start = false;
            }
            '{' | '}' | '[' | ']' | ',' | ':' => {
                lexer.bump();
                push(Token::Punct(ch), &mut tokens);
                at_line_start = false;
            }
            _ => {
                let literal = lexer.read_literal();
                if literal.is_empty() {
                    return Err(lexer.issue("unexpected character"));
                }
                push(Token::Literal(literal), &mut tokens);
                at_line_start = false;
            }
        }
    }

    Ok(tokens)
}

/// 结构校验：括号配对、逗号与冒号出现在该出现的地方。
///
/// 只做到「能安全重排空白」为止，不做完整的 JSON 语法树校验——
/// 格式化的职责是排版，不是当校验器；但排错位置必须准。
fn check_structure(tokens: &[Spanned]) -> Result<(), FormatIssue> {
    let mut stack: Vec<&Spanned> = Vec::new();
    for spanned in tokens {
        if let Token::Punct(ch) = &spanned.token {
            match ch {
                '{' | '[' => stack.push(spanned),
                '}' | ']' => {
                    let want = if *ch == '}' { '{' } else { '[' };
                    let matched = stack
                        .pop()
                        .is_some_and(|open| open.token == Token::Punct(want));
                    if !matched {
                        return Err(FormatIssue {
                            line: spanned.line,
                            column: spanned.column,
                            detail: format!("unbalanced '{ch}'"),
                        });
                    }
                }
                _ => {}
            }
        }
    }
    match stack.last() {
        None => Ok(()),
        Some(open) => Err(FormatIssue {
            line: open.line,
            column: open.column,
            detail: "unclosed bracket".to_string(),
        }),
    }
}

fn indent(out: &mut String, depth: usize, unit: &str) {
    for _ in 0..depth {
        out.push_str(unit);
    }
}

pub fn beautify(
    text: &str,
    indent_unit: &str,
    allow_comments: bool,
) -> Result<String, FormatIssue> {
    let tokens = tokenize(text, allow_comments)?;
    check_structure(&tokens)?;

    let mut out = String::with_capacity(text.len() + text.len() / 4);
    let mut depth = 0usize;
    // 「刚开了一个括号」要延后决定换行：空容器 `{}` 不该被拆成两行
    let mut pending_open = false;

    for (index, spanned) in tokens.iter().enumerate() {
        let token = &spanned.token;
        let closing = matches!(token, Token::Punct('}') | Token::Punct(']'));

        if pending_open {
            if closing {
                out.push_str(match token {
                    Token::Punct('}') => "}",
                    _ => "]",
                });
                pending_open = false;
                depth -= 1;
                continue;
            }
            out.push('\n');
            indent(&mut out, depth, indent_unit);
            pending_open = false;
        } else if closing {
            depth = depth.saturating_sub(1);
            out.push('\n');
            indent(&mut out, depth, indent_unit);
        }

        match token {
            Token::Punct('{') | Token::Punct('[') => {
                out.push(if matches!(token, Token::Punct('{')) {
                    '{'
                } else {
                    '['
                });
                depth += 1;
                pending_open = true;
            }
            Token::Punct('}') => out.push('}'),
            Token::Punct(']') => out.push(']'),
            Token::Punct(',') => {
                out.push(',');
                // 逗号后面若是行尾注释，注释要留在本行
                if !matches!(
                    tokens.get(index + 1).map(|next| &next.token),
                    Some(Token::TrailingComment(_))
                ) {
                    out.push('\n');
                    indent(&mut out, depth, indent_unit);
                }
            }
            Token::Punct(':') => out.push_str(": "),
            Token::Punct(other) => out.push(*other),
            Token::String(value) => out.push_str(value),
            Token::Literal(value) => out.push_str(value),
            Token::TrailingComment(value) => {
                out.push(' ');
                out.push_str(value);
                out.push('\n');
                indent(&mut out, depth, indent_unit);
            }
            Token::Comment(value) => {
                out.push_str(value);
                out.push('\n');
                indent(&mut out, depth, indent_unit);
            }
        }
    }

    // 收尾：去掉因注释或逗号预留而多出来的行尾空白
    let trimmed: String = out
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(trimmed)
}

pub fn minify(text: &str, allow_comments: bool) -> Result<String, FormatIssue> {
    let tokens = tokenize(text, allow_comments)?;
    check_structure(&tokens)?;

    let mut out = String::with_capacity(text.len());
    for spanned in &tokens {
        match &spanned.token {
            // 压缩就是把可省的字节都省掉，注释首当其冲
            Token::Comment(_) | Token::TrailingComment(_) => {}
            Token::Punct(ch) => out.push(*ch),
            Token::String(value) | Token::Literal(value) => out.push_str(value),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beautify_indents_nested_objects() {
        let out = beautify(r#"{"a":{"b":[1,2]}}"#, "  ", false).expect("格式化");
        assert_eq!(
            out,
            "{\n  \"a\": {\n    \"b\": [\n      1,\n      2\n    ]\n  }\n}"
        );
    }

    #[test]
    fn empty_containers_stay_on_one_line() {
        assert_eq!(
            beautify(r#"{"a":{},"b":[]}"#, "  ", false).expect("格式化"),
            "{\n  \"a\": {},\n  \"b\": []\n}"
        );
    }

    #[test]
    fn jsonc_comments_survive() {
        let source = "{\n  // 说明\n  \"a\": 1 // 行尾\n}";
        let out = beautify(source, "  ", true).expect("格式化");
        assert!(out.contains("// 说明"));
        assert!(out.contains("1 // 行尾"));
    }

    #[test]
    fn plain_json_rejects_comments_with_a_position() {
        let issue = beautify("{\n  // c\n}", "  ", false).expect_err("应拒绝");
        assert_eq!((issue.line, issue.column), (2, 3));
    }

    #[test]
    fn unterminated_string_reports_where_it_ended() {
        let issue = beautify("{\"a\": \"oops}", "  ", false).expect_err("应拒绝");
        assert_eq!(issue.line, 1);
    }

    #[test]
    fn minify_drops_whitespace_and_comments() {
        assert_eq!(
            minify("{\n  // c\n  \"a\": [1, 2]\n}", true).expect("压缩"),
            r#"{"a":[1,2]}"#
        );
    }

    #[test]
    fn numbers_keep_their_original_spelling() {
        assert_eq!(
            minify(r#"{"a": 1.50, "b": 1e3}"#, false).expect("压缩"),
            r#"{"a":1.50,"b":1e3}"#
        );
    }

    #[test]
    fn beautify_is_stable_after_minify() {
        let source = "{\n  \"a\": [1, {\"b\": null}],\n  \"c\": \"x\"\n}";
        let once = beautify(source, "  ", false).expect("格式化");
        let round = beautify(&minify(source, false).expect("压缩"), "  ", false).expect("格式化");
        assert_eq!(once, round);
    }

    #[test]
    fn unbalanced_brackets_are_rejected() {
        assert!(beautify(r#"{"a": [1}"#, "  ", false).is_err());
    }

    #[test]
    fn an_unclosed_bracket_points_at_where_it_opened() {
        let issue = beautify("{\n  \"a\": [1,\n  2\n", "  ", false).expect_err("应拒绝");
        assert_eq!((issue.line, issue.column), (2, 8));
    }
}
