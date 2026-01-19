import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number.parseInt(process.env.BOOTTY_TEST_PORT ?? "4173", 10);
const root = process.env.BOOTTY_TEST_ROOT ?? path.resolve(__dirname, "..");
const extraRoots = new Map([["libghostty-webgl", path.resolve(root, "../libghostty-webgl")]]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
]);

function contentType(filePath) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function isWithinRoot(resolvedRoot, resolvedPath) {
  if (resolvedPath === resolvedRoot) return true;
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedPath.startsWith(rootWithSep);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const decodedPath = decodeURIComponent(url.pathname);
    const safePath = decodedPath.replace(/^\/+/, "");
    const segments = safePath.split("/").filter(Boolean);
    const extraRoot = segments.length > 0 ? extraRoots.get(segments[0]) : undefined;
    const baseRoot = extraRoot ?? root;
    const relativePath =
      segments.length === 0
        ? "playwright/harness/index.html"
        : extraRoot
          ? segments.slice(1).join("/")
          : safePath;
    const filePath = path.join(baseRoot, relativePath);

    const resolvedRoot = path.resolve(baseRoot);
    const resolved = path.resolve(filePath);
    if (!isWithinRoot(resolvedRoot, resolved)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let resolvedFile = resolved;
    if (path.extname(resolvedFile) === "") {
      const jsCandidate = `${resolvedFile}.js`;
      const mjsCandidate = `${resolvedFile}.mjs`;
      const hasJs = await fs
        .stat(jsCandidate)
        .then((stat) => stat.isFile())
        .catch(() => false);
      const hasMjs = hasJs
        ? false
        : await fs
            .stat(mjsCandidate)
            .then((stat) => stat.isFile())
            .catch(() => false);
      if (hasJs) {
        resolvedFile = jsCandidate;
      } else if (hasMjs) {
        resolvedFile = mjsCandidate;
      }
    }

    const data = await fs.readFile(resolvedFile);
    res.writeHead(200, {
      "Content-Type": contentType(resolvedFile),
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Playwright server running at http://127.0.0.1:${port}\n`);
});
