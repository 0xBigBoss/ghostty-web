declare module "fs/promises" {
  export function readFile(path: string): Promise<Uint8Array>;
}
