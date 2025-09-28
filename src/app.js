import dotenv from "dotenv";
import express from 'express';
import morgan from 'morgan';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

const app = express();
dotenv.config();
const PORT = Number(process.env.APP_PORT || 8080);
const PROXY_LOG = String(process.env.PROXY_LOG || 'false') === 'true';


const ACCOUNT_UPSTREAM = process.env.ACCOUNT_UPSTREAM;
const CHAT_UPSTREAM = process.env.CHAT_UPSTREAM;
const NOTIFICATION_UPSTREAM = process.env.NOTIFICATION_UPSTREAM;


// ====== Middlewares chung ======
app.disable('x-powered-by');
app.use(morgan('tiny'));

// Healthcheck
app.get(['/health', '/live', '/ready'], (_req, res) => {
  res.status(200).json({ ok: true });
});


const makeProxy = ({ target, stripPrefix, ws = false }) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws,
    logLevel: PROXY_LOG ? 'debug' : 'warn',
    // Bỏ prefix trước khi forward tới upstream
    pathRewrite: (path, req) => {
      // ví dụ: /account/users -> /users
      if (path.startsWith(stripPrefix)) {
        return path.replace(stripPrefix, '') || '/';
      }
      return path;
    },
    // Nếu muốn can thiệp response (debug/transform), bật interceptor:
    selfHandleResponse: false,
    on: {
      proxyReq: (proxyReq, req) => {
        // có thể set/remove header ở đây nếu cần
        // proxyReq.setHeader('X-Forwarded-By', 'mini-api-gateway');
      },
      proxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
        // trả thẳng response (không sửa) – để mẫu ở đây nếu bạn muốn inspect sau này
        return buffer;
      }),
      error: (err, req, res) => {
        console.error('Proxy error:', err?.message);
        res.status?.(502).json?.({ message: 'Bad gateway' });
      },
    },
  });
};


app.use('/account', makeProxy({ target: ACCOUNT_UPSTREAM, stripPrefix: '/account' }));

app.use('/chat', makeProxy({ target: CHAT_UPSTREAM, stripPrefix: '/chat', ws: true }));


app.use('/notification', makeProxy({ target: NOTIFICATION_UPSTREAM, stripPrefix: '/notification' }));

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found at gateway' });
});

// Graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`Gateway listening on :${PORT}`);
});
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`\nShutting down (${sig})...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
});
