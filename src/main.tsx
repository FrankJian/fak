import { lazy, StrictMode, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { logger } from "./lib/logger";

const App = lazy(async () => {
  const module = await import("./app/App");
  return { default: module.App };
});

// 渲染之外的失败（事件回调、未处理的 Promise）不经错误边界，得在这里留痕
window.addEventListener("error", (event) =>
  logger.error("uncaught error", event.error ?? event.message),
);
window.addEventListener("unhandledrejection", (event) =>
  logger.error("unhandled rejection", event.reason),
);

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");

ReactDOM.createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense
        fallback={
          <div
            className="flex h-full items-center justify-center bg-[var(--bg-base)] text-[var(--text-tertiary)]"
            aria-busy="true"
          >
            Fak
          </div>
        }
      >
        <App />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
