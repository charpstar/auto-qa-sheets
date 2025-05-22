/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Disable ESLint during builds
    ignoreDuringBuilds: true,
  },
  images: {
    domains: [
      "qaa7ne165y51xnuj.public.blob.vercel-storage.com", // Your specific Blob storage domain
      "public.blob.vercel-storage.com", // Generic domain for all Vercel Blob storage
    ],
  },
};

module.exports = nextConfig;
