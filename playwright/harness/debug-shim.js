export default function debug() {
  const noop = () => {};
  noop.enabled = false;
  return noop;
}
