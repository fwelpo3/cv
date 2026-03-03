/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
      remotePatterns: [
        { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }
      ]
    }
  };
  module.exports = nextConfig;
  ```
  
  ---
  
  ### `.env.local`
  ```
  BLOB_READ_WRITE_TOKEN=dein_token_von_vercel