/**
 * serve.js — 静态服务器，用于在浏览器里预览前端（不打包 exe 也能看效果）
 *
 * 用法：npm run serve  然后打开 http://127.0.0.1:5178
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const PORT = Number(process.env.PORT || 5178);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end('400 Bad Request');
    return;
  }
  if (url.includes('\0')) {
    res.writeHead(400).end('400 Bad Request');
    return;
  }
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);

  // 防目录穿越
  const relative = path.relative(ROOT, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    res.writeHead(403).end('403 Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  卡片生成器已启动');
  console.log(`  http://127.0.0.1:${server.address().port}`);
  console.log('');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});