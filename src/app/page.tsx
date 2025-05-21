"use client";

import { useState } from "react";
import Image from "next/image";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/test-model-viewer");
      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || "Test failed");
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8">Headless Model-Viewer Test</h1>

        <div className="mb-8">
          <button
            onClick={runTest}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {loading ? "Running Test..." : "Run Headless Test"}
          </button>
        </div>

        {loading && (
          <div className="mt-4">
            <p className="text-gray-600">
              Running test, this may take up to a minute...
            </p>
            <div className="mt-2 w-full h-2 bg-gray-200 rounded-full">
              <div className="h-full bg-blue-500 rounded-full animate-pulse"></div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">
            <h2 className="font-bold">Error:</h2>
            <p>{error}</p>
          </div>
        )}

        {result && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Test Results:</h2>
            <p className="text-green-600 font-bold mb-4">
              ✅ Test completed successfully!
            </p>

            <div className="mt-8">
              <h3 className="text-xl font-bold mb-4">Screenshots:</h3>
              <div className="grid grid-cols-2 gap-4">
                {result.screenshots.map((screenshot: string, index: number) => (
                  <div
                    key={index}
                    className="border rounded-lg overflow-hidden"
                  >
                    <p className="p-2 bg-gray-100 font-bold">
                      {index === 0 ? "Default View" : `Angle ${index}`}
                    </p>
                    <Image
                      src={screenshot}
                      alt={`Screenshot ${index}`}
                      width={800}
                      height={600}
                      className="w-full h-auto"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
