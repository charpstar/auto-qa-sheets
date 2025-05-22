"use client";

import { useState } from "react";
import Link from "next/link";

interface TestResult {
  success: boolean;
  message: string;
  articleId?: string;
  fileName?: string;
  blobUrl?: string;
  fileSize?: number;
  error?: string;
  found?: boolean;
  fileId?: string;
}

export default function DriveTest() {
  const [articleId, setArticleId] = useState("92275");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const testConnection = async () => {
    try {
      setIsLoading(true);
      setTestResult(null);

      console.log("Testing Google Drive connection...");

      const response = await fetch(`/api/download-glb?articleId=${articleId}`);
      const result = await response.json();

      console.log("Test result:", result);
      setTestResult(result);
    } catch (error) {
      console.error("Test failed:", error);
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : "Test failed",
        message: "Connection test failed",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadGLB = async () => {
    try {
      setIsLoading(true);

      const response = await fetch("/api/download-glb", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ articleId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData?.error || "Download failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${articleId}.glb`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : "Download failed",
        message: "GLB download failed",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center p-6">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="mb-6">
          <Link href="/" className="text-blue-500 hover:underline">
            ← Back to Home
          </Link>
        </div>

        <h1 className="text-3xl font-bold mb-8">
          🗂️ Google Drive Integration Test
        </h1>

        {/* Test Form */}
        <div className="bg-white p-6 rounded-lg border mb-6">
          <h2 className="text-xl font-bold mb-4">Test GLB File Download</h2>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Article ID:
            </label>
            <input
              type="text"
              value={articleId}
              onChange={(e) => setArticleId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter Article ID (e.g., 92275)"
            />
            <p className="text-xs text-gray-500 mt-1">
              This will look for a file named "{articleId}.glb" in your Google
              Drive folder
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={testConnection}
              disabled={isLoading || !articleId}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
            >
              {isLoading ? "🔍 Testing..." : "🔍 Test Connection"}
            </button>

            <button
              onClick={downloadGLB}
              disabled={isLoading || !articleId}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
            >
              {isLoading ? "📥 Downloading..." : "📥 Download GLB"}
            </button>
          </div>
        </div>

        {/* Test Results */}
        {testResult && (
          <div
            className={`p-6 rounded-lg border mb-6 ${
              testResult.success || testResult.found
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <h3 className="font-bold mb-3">
              {testResult.success || testResult.found
                ? "✅ Success"
                : "❌ Error"}
            </h3>

            <div className="space-y-2 text-sm">
              <p>
                <strong>Message:</strong> {testResult.message}
              </p>

              {testResult.articleId && (
                <p>
                  <strong>Article ID:</strong> {testResult.articleId}
                </p>
              )}

              {testResult.found !== undefined && (
                <p>
                  <strong>File Found:</strong> {testResult.found ? "Yes" : "No"}
                </p>
              )}

              {testResult.fileId && (
                <p>
                  <strong>Google Drive File ID:</strong> {testResult.fileId}
                </p>
              )}

              {testResult.fileName && (
                <p>
                  <strong>File Name:</strong> {testResult.fileName}
                </p>
              )}

              {testResult.fileSize && (
                <p>
                  <strong>File Size:</strong>{" "}
                  {(testResult.fileSize / 1024 / 1024).toFixed(2)} MB
                </p>
              )}

              {testResult.blobUrl && (
                <div>
                  <p>
                    <strong>Blob URL:</strong>
                  </p>
                  <a
                    href={testResult.blobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline break-all text-xs"
                  >
                    {testResult.blobUrl}
                  </a>
                </div>
              )}

              {testResult.error && (
                <p className="text-red-700">
                  <strong>Error:</strong> {testResult.error}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 p-6 rounded-lg border-l-4 border-blue-400">
          <h2 className="text-lg font-bold mb-4">📋 Setup Instructions</h2>

          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">
                ✅ Prerequisites Checklist:
              </h3>
              <ul className="list-disc list-inside space-y-1 text-gray-700">
                <li>Google Cloud project with Drive API enabled</li>
                <li>Service account created with JSON credentials</li>
                <li>
                  Google Drive folder created and shared with service account
                </li>
                <li>Environment variables set in .env.local file</li>
                <li>
                  Test GLB file uploaded to Drive folder (named "{articleId}
                  .glb")
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">
                🔧 Environment Variables Required:
              </h3>
              <ul className="list-disc list-inside space-y-1 text-gray-700 text-xs">
                <li>GOOGLE_DRIVE_FOLDER_ID</li>
                <li>GOOGLE_CLIENT_EMAIL</li>
                <li>GOOGLE_PRIVATE_KEY</li>
                <li>GOOGLE_PROJECT_ID</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">🧪 Testing Process:</h3>
              <ol className="list-decimal list-inside space-y-1 text-gray-700">
                <li>
                  First click "Test Connection" to verify the GLB file exists
                </li>
                <li>
                  If found, click "Download GLB" to download and upload to Blob
                  storage
                </li>
                <li>
                  Check the Blob URL to confirm the file was processed correctly
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
