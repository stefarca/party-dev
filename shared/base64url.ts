// base64url (RFC 4648 §5), which is how every key and secret in the web push
// protocol is spelled — in the subscription a browser hands the app, in the
// VAPID key pair, and in the JWT the Worker signs with it.
//
// Shared because both ends need it and they must agree exactly: the client
// decodes the application server key to hand `pushManager.subscribe()` the
// bytes it wants, and worker/push.ts decodes the very same string to sign
// with. `atob`/`btoa` exist in both runtimes; a Node-style Buffer does not.

export function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
