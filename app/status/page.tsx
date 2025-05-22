"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface StatusChange {
  id: string;
  articleId: string;
  productName: string;
  status: string;
  oldStatus: string;
  referenceCount?: number;
  references?: string[];
  timestamp: string;
  sheetName: string;
  rowIndex: number;
  shouldStartQA: boolean;
  triggerType: string;
}

export default function StatusMonitor() {
  const [statusChanges, setStatusChanges] = useState<StatusChange[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalChanges, setTotalChanges] = useState(0);

  // Fetch status changes from the API
  const fetchStatusChanges = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setIsLoading(true);
      setError(null);

      const response = await fetch("/api/status-change?limit=50");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.recentChanges && Array.isArray(data.recentChanges)) {
        setStatusChanges(data.recentChanges);
        setTotalChanges(data.recentChangesCount || data.recentChanges.length);
        setLastUpdate(new Date().toLocaleTimeString());
      } else {
        console.warn("No recentChanges array in response:", data);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch status changes";
      setError(errorMessage);
      console.error("Error fetching status changes:", err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  // Auto-refresh every 3 seconds when polling is enabled
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isPolling) {
      // Initial fetch
      fetchStatusChanges();

      // Set up polling
      interval = setInterval(() => {
        fetchStatusChanges();
      }, 3000); // Poll every 3 seconds
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isPolling, fetchStatusChanges]);

  // Test the endpoint with sample data
  const testEndpoint = async () => {
    try {
      setTestResult("Testing...");

      // Test POST with sample data
      const testData = {
        articleId: "TEST-" + Date.now(),
        productName: "Test Product",
        status: "Delivered by Artist",
        oldStatus: "Not sta",
        references: [
          "https://example.com/ref1.jpg",
          "https://example.com/ref2.jpg",
        ],
        sheetId: "test-sheet-id",
        sheetName: "Test Sheet",
        rowIndex: 999,
        timestamp: new Date().toISOString(),
        triggerType: "manual_test",
      };

      const postResponse = await fetch("/api/status-change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testData),
      });

      const postData = await postResponse.json();

      setTestResult(
        `Test successful! Response: ${JSON.stringify(postData, null, 2)}`
      );

      // Refresh the status changes to show the new test entry
      setTimeout(() => fetchStatusChanges(true), 1000);
    } catch (error) {
      setTestResult(
        `Test failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const clearLogs = () => {
    setStatusChanges([]);
    setTestResult(null);
    setError(null);
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getStatusBadgeColor = (status: string) => {
    if (status.toLowerCase().includes("deliver")) {
      return "bg-green-100 text-green-800";
    } else if (status.toLowerCase().includes("not")) {
      return "bg-gray-100 text-gray-800";
    } else if (status.toLowerCase().includes("prod")) {
      return "bg-blue-100 text-blue-800";
    }
    return "bg-yellow-100 text-yellow-800";
  };

  return (
    <div className="flex min-h-screen flex-col items-center p-6">
      <div className="max-w-7xl w-full">
        {/* Header */}
        <div className="mb-6">
          <Link href="/" className="text-blue-500 hover:underline">
            ← Back to Home
          </Link>
        </div>

        <h1 className="text-3xl font-bold mb-8">📊 Status Change Monitor</h1>

        {/* Status Bar */}
        <div className="bg-white p-4 rounded-lg border mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={`flex items-center gap-2 ${
                  isPolling ? "text-green-600" : "text-gray-600"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    isPolling ? "bg-green-500 animate-pulse" : "bg-gray-400"
                  }`}
                ></div>
                <span className="text-sm font-medium">
                  {isPolling ? "Live Monitoring" : "Monitoring Paused"}
                </span>
              </div>

              {lastUpdate && (
                <span className="text-sm text-gray-500">
                  Last update: {lastUpdate}
                </span>
              )}

              <span className="text-sm text-gray-500">
                Total changes: {totalChanges}
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => fetchStatusChanges(true)}
                disabled={isLoading}
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:bg-gray-400"
              >
                {isLoading ? "Refreshing..." : "🔄 Refresh"}
              </button>

              <button
                onClick={() => setIsPolling(!isPolling)}
                className={`px-3 py-1 rounded text-sm text-white ${
                  isPolling
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-green-500 hover:bg-green-600"
                }`}
              >
                {isPolling ? "⏸️ Pause" : "▶️ Start"} Monitor
              </button>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="mb-6 p-4 bg-white rounded-lg border">
          <h2 className="text-lg font-bold mb-3">🔧 Controls</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={testEndpoint}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              🧪 Test Endpoint
            </button>

            <button
              onClick={clearLogs}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              🗑️ Clear Display
            </button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h3 className="font-bold text-red-800 mb-2">❌ Error</h3>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
            <h3 className="font-bold mb-2">🧪 Test Result:</h3>
            <pre className="text-sm overflow-auto whitespace-pre-wrap text-gray-700 bg-white p-3 rounded border">
              {testResult}
            </pre>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 p-6 rounded-lg border-l-4 border-blue-400 mb-6">
          <h2 className="text-lg font-bold mb-3">📋 How to Use:</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>
              <strong>Monitor automatically:</strong> Status changes appear here
              in real-time
            </li>
            <li>
              <strong>Google Sheets integration:</strong> Change any status in
              column H of your sheet
            </li>
            <li>
              <strong>Test manually:</strong> Click "Test Endpoint" to add a
              sample entry
            </li>
            <li>
              <strong>Check server logs:</strong> Status changes also appear in
              your server console
            </li>
          </ol>
          <div className="mt-3 text-xs text-gray-600">
            <strong>Server:</strong> http://45.76.82.207:3000/api/status-change
          </div>
        </div>

        {/* Status Changes Display */}
        <div className="bg-white p-6 rounded-lg border">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">📋 Recent Status Changes</h2>
            <div className="text-sm text-gray-500">
              {statusChanges.length} change
              {statusChanges.length !== 1 ? "s" : ""} shown
            </div>
          </div>

          {isLoading && statusChanges.length === 0 ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <p className="mt-2 text-gray-500">Loading status changes...</p>
            </div>
          ) : statusChanges.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <div className="text-4xl mb-4">📭</div>
              <p className="text-lg mb-2">No status changes yet</p>
              <p className="text-sm">
                Make a change in your Google Sheet or run the test to see
                entries here
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {statusChanges.map((change, index) => (
                <div
                  key={change.id || index}
                  className={`p-4 rounded-lg border-l-4 transition-all hover:shadow-md ${
                    change.shouldStartQA
                      ? "bg-green-50 border-green-400 hover:bg-green-100"
                      : "bg-gray-50 border-gray-400 hover:bg-gray-100"
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-lg">
                        #{change.articleId}
                      </span>
                      <span className="text-sm bg-gray-200 px-2 py-1 rounded max-w-xs truncate">
                        {change.productName}
                      </span>
                      {change.shouldStartQA && (
                        <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded font-medium">
                          🚀 QA Triggered
                        </span>
                      )}
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {change.triggerType}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(change.timestamp)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-semibold">Status Change:</span>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs ${getStatusBadgeColor(
                            change.oldStatus
                          )}`}
                        >
                          {change.oldStatus}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span
                          className={`px-2 py-1 rounded text-xs ${getStatusBadgeColor(
                            change.status
                          )}`}
                        >
                          {change.status}
                        </span>
                      </div>
                    </div>

                    <div>
                      <span className="font-semibold">Details:</span>
                      <div className="mt-1 space-y-1 text-xs text-gray-600">
                        <div>
                          📄 Sheet: {change.sheetName}, Row: {change.rowIndex}
                        </div>
                        <div>
                          🖼️ References: {change.references?.length || 0} image
                          {(change.references?.length || 0) !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
