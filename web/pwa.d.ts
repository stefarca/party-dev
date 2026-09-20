// `virtual:pwa-register/react` is resolved by vite-plugin-pwa: in a build it is the real
// registration helper, and in a dev server, where no service worker is registered at all, it is
// a stub whose flags never flip. tsconfig.client.json deliberately loads no ambient @types
// packages, so its declaration is referenced here, beside the only code that imports it, instead
// of being added to that file's `types` array.
/// <reference types="vite-plugin-pwa/react" />
