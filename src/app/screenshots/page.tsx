"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function Screenshots() {
  const [screenshots, setScreenshots] = useState<string[]>([]);

  useEffect(() => {
    // Check if /public/screenshots directory has files
    fetch("/api/test-model-viewer")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.screenshots) {
          setScreenshots(data.screenshots);
        }
      })
      .catch((err) => {
        console.error("Error fetching screenshots:", err);
      });
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center p-24">
      <div className="max-w-5xl w-full">
        <div className="mb-6">
          <Link href="/" className="text-blue-500 hover:underline">
            ← Back to Test Page
          </Link>
        </div>

        <h1 className="text-3xl font-bold mb-8">Model-Viewer Screenshots</h1>

        {screenshots.length === 0 ? (
          <p>No screenshots found. Run the test first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-8">
            {screenshots.map((screenshot, index) => (
              <div key={index} className="border rounded-lg overflow-hidden">
                <div className="p-3 bg-gray-100 flex justify-between items-center">
                  <h2 className="font-bold">
                    {index === 0 ? "Default View" : `Angle ${index}`}
                  </h2>
                  <a
                    href={screenshot}
                    download={`screenshot-${index}.png`}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                  >
                    Download
                  </a>
                </div>
                <img
                  src={screenshot}
                  alt={`Screenshot ${index}`}
                  className="w-full h-auto"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
