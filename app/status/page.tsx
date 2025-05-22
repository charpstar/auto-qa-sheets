"use client";

import { useState } from "react";
import Link from "next/link";

interface StatusChange {
  articleId: string;
  status: string;
  referenceCount: number;
  timestamp: string;
}

export default function StatusMonitor() {
  const [statusChanges, setStatusChanges] = useState<StatusChange[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);

  const testEndpoint = async () => {
    try {
      // Test the GET endpoint first
      const getResponse = await fetch("/api/status-change");
      const getData = await getResponse.json();
      console.log("GET response:", getData);

      // Test the POST endpoint with sample data
      const testData = {
        articleId: "TEST001",
        status: "Delivered by Artist",
        references: [
          "https://cdn-02.synsam.com/product-images/XL/90342-0.jpg",
          "https://cdn-04.synsam.com/product-images/XL/90327-0.jpg",
        ],
        sheetId: "test-sheet-id",
        rowIndex: 2,
        timestamp: new Date().toISOString(),
      };

      const postResponse = await fetch("/api/status-change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testData),
      });

      const postData = await postResponse.json();
      console.log("POST response:", postData);

      setTestResult(
        `Test successful! Check server console for logs. Response: ${JSON.stringify(
          postData,
          null,
          2
        )}`
      );
    } catch (error) {
      setTestResult(
        `Test failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center p-24">
      <div className="max-w-5xl w-full">
        <div className="mb-6">
          <Link href="/" className="text-blue-500 hover:underline">
            ← Back to Home
          </Link>
        </div>

        <h1 className="text-3xl font-bold mb-8">Status Change Monitor</h1>

        <div className="mb-8">
          <button
            onClick={testEndpoint}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Test Status Change Endpoint
          </button>
        </div>

        {testResult && (
          <div className="mb-8 p-4 bg-gray-100 rounded">
            <h3 className="font-bold mb-2">Test Result:</h3>
            <pre className="text-sm overflow-auto">{testResult}</pre>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg border">
          <h2 className="text-xl font-bold mb-4">Instructions:</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>
              Click "Test Status Change Endpoint" to verify the API is working
            </li>
            <li>
              Check your server console for the formatted status change logs
            </li>
            <li>
              Set up your Google Apps Script with this URL:{" "}
              <code className="bg-gray-100 px-2 py-1 rounded">
                http://45.76.82.207:8080/api/status-change
              </code>
            </li>
            <li>
              Change a status in your Google Sheet to see real status changes
            </li>
          </ol>
        </div>

        <div className="mt-8 bg-yellow-50 p-4 rounded border-l-4 border-yellow-400">
          <h3 className="font-bold text-yellow-800">Next Steps:</h3>
          <p className="text-yellow-700 text-sm mt-2">
            Once you confirm the status changes are being received, we'll
            integrate this with your existing model-viewer screenshot
            functionality to create the complete QA pipeline.
          </p>
        </div>
      </div>
    </div>
  );
}
