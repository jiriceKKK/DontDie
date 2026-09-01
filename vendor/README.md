# Vendored third-party browser code

## `supabase-js-2.112.4.umd.js`

- **Package:** `@supabase/supabase-js`
- **Version:** 2.112.4 (exact — never a floating major tag)
- **License:** MIT
- **Source:** `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js`
- **SHA-384 (base64, Subresource Integrity form):**
  `ysv13JVP3fufiEXfjML9OdCa/rRbMJvUBOWyor82wfuK8INNZAvmbxHgKIHi+oqz`

### Why it is vendored

`index.html` previously loaded this library from `cdn.jsdelivr.net` at the
floating `@2` tag. That meant a third party could change the code running in the
app at any time, and the Content Security Policy had to allow a whole CDN as a
script source. Serving the exact artifact from our own origin lets the policy
stay at `script-src 'self'` and makes the running version reproducible.

### How to update

1. Pick the new exact version and download the UMD build:

   ```sh
   curl -sSL -o vendor/supabase-js-<version>.umd.js \
     "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<version>/dist/umd/supabase.js"
   ```

2. Record the integrity hash of what you actually downloaded:

   ```sh
   openssl dgst -sha384 -binary vendor/supabase-js-<version>.umd.js | openssl base64 -A
   ```

3. Update the `<script src="vendor/...">` tag in `index.html`, update this file
   (version, source URL, hash), delete the previous artifact, bump the `CACHE`
   constant in `sw.js`, and run `npm run validate`.

Do not edit the vendored file. If a patch is ever required, upstream it.
