"use client";

import React, { useState, useEffect } from "react";

interface StatusChange {
  id: string;
  articleId: string;
  productName: string;
  status: string;
  oldStatus: string;
  timestamp: string;
  shouldStartQA: boolean;
  references: string[];
}

interface QueueJob {
  id: string;
  articleId: string;
  productName: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  retries: number;
  maxRetries: number;
  error?: string;
  screenshots?: string[];
  aiAnalysis?: {
    differences: Array<{
      renderIndex: number;
      referenceIndex: number;
      issues: string[];
      bbox: [number, number, number, number];
      severity: "low" | "medium" | "high";
    }>;
    summary: string;
    status: "Approved" | "Not Approved";
    scores?: {
      silhouette: number;
      proportion: number;
      colorMaterial: number;
      overall: number;
    };
  };
  pdfUrl?: string;
  processingLogs: string[];
}

interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  isProcessing: boolean;
}

const QAMonitorDashboard = () => {
  const [statusChanges, setStatusChanges] = useState<StatusChange[]>([]);
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  // Fetch status changes from your existing API
  const fetchStatusChanges = async (): Promise<QueueStatus | null> => {
    try {
      const response = await fetch("/api/status-change");
      const data = await response.json();
      setStatusChanges(data.recentChanges || []);
      return data.queueStatus;
    } catch (error) {
      console.error("Error fetching status changes:", error);
      return null;
    }
  };

  // Fetch queue information
  const fetchQueueData = async (): Promise<void> => {
    try {
      const response = await fetch("/api/queue");
      const data = await response.json();
      setQueueJobs(data.jobs || []);
      setQueueStatus(data.queueStatus);
    } catch (error) {
      console.error("Error fetching queue data:", error);
    }
  };

  // Refresh all data
  const refreshData = async (): Promise<void> => {
    setLoading(true);
    await Promise.all([fetchStatusChanges(), fetchQueueData()]);
    setLastUpdate(new Date());
    setLoading(false);
  };

  // Auto-refresh every 3 seconds
  useEffect(() => {
    // Only run on client side
    if (typeof window === "undefined") return;

    refreshData();

    if (autoRefresh) {
      const interval = setInterval(refreshData, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Get status badge
  const getStatusBadge = (status: QueueJob["status"]) => {
    const configs: Record<QueueJob["status"], { color: string; icon: string }> =
      {
        pending: { color: "bg-yellow-100 text-yellow-800", icon: "⏳" },
        processing: { color: "bg-blue-100 text-blue-800", icon: "🔄" },
        completed: { color: "bg-green-100 text-green-800", icon: "✅" },
        failed: { color: "bg-red-100 text-red-800", icon: "❌" },
      };

    const config = configs[status];

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
      >
        <span className="mr-1">{config.icon}</span>
        {status}
      </span>
    );
  };

  // Format timestamp safely for SSR
  const formatTime = (timestamp: string): string => {
    // Only format on client side to avoid hydration mismatches
    if (typeof window === "undefined") {
      return timestamp; // Return raw timestamp on server
    }
    return new Date(timestamp).toLocaleString();
  };

  // Calculate processing duration
  const getProcessingDuration = (job: QueueJob): string | null => {
    if (!job.startedAt) return null;
    const start = new Date(job.startedAt).getTime();
    const end = job.completedAt
      ? new Date(job.completedAt).getTime()
      : new Date().getTime();
    const seconds = Math.floor((end - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                3D Model QA Monitor
              </h1>
              <p className="text-gray-600 mt-2">
                Real-time monitoring of Google Sheets changes and processing
                queue
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-gray-600">Auto-refresh</span>
              </label>
              <button
                onClick={refreshData}
                disabled={loading}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <span className={`mr-2 ${loading ? "animate-spin" : ""}`}>
                  🔄
                </span>
                Refresh
              </button>
            </div>
          </div>
          <div className="text-sm text-gray-500 mt-2">
            Last updated:{" "}
            {typeof window !== "undefined"
              ? lastUpdate.toLocaleString()
              : lastUpdate.toISOString()}
          </div>
        </div>

        {/* Queue Status Overview */}
        {queueStatus && (
          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Queue Status</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {queueStatus.pending}
                </div>
                <div className="text-sm text-gray-600">Pending</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {queueStatus.processing}
                </div>
                <div className="text-sm text-gray-600">Processing</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {queueStatus.completed}
                </div>
                <div className="text-sm text-gray-600">Completed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">
                  {queueStatus.failed}
                </div>
                <div className="text-sm text-gray-600">Failed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-600">
                  {queueStatus.total}
                </div>
                <div className="text-sm text-gray-600">Total</div>
              </div>
            </div>
            <div className="mt-4 text-center">
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${
                  queueStatus.isProcessing
                    ? "bg-blue-100 text-blue-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {queueStatus.isProcessing ? "🔄 Queue Active" : "⏸️ Queue Idle"}
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Status Changes */}
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">
                Recent Google Sheets Changes
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                Status changes detected from your Google Sheet
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {statusChanges.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  No status changes detected yet
                </div>
              ) : (
                statusChanges.slice(0, 10).map((change) => (
                  <div
                    key={change.id}
                    className="p-4 border-b last:border-b-0 hover:bg-gray-50"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          Article {change.articleId}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {change.productName}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {change.oldStatus} → {change.status}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {formatTime(change.timestamp)}
                        </div>
                      </div>
                      <div className="flex flex-col items-end space-y-2">
                        {change.shouldStartQA && (
                          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                            QA Triggered
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {change.references.length} refs
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Processing Queue */}
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Processing Queue</h2>
              <p className="text-gray-600 text-sm mt-1">
                Jobs in the processing pipeline
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {queueJobs.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  No jobs in queue
                </div>
              ) : (
                queueJobs.map((job) => (
                  <div
                    key={job.id}
                    className="p-4 border-b last:border-b-0 hover:bg-gray-50"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          Article {job.articleId}
                        </div>
                        <div className="text-sm text-gray-600">
                          {job.productName}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Created: {formatTime(job.createdAt)}
                        </div>
                        {getProcessingDuration(job) && (
                          <div className="text-xs text-gray-500">
                            Duration: {getProcessingDuration(job)}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end space-y-1">
                        {getStatusBadge(job.status)}
                        {job.retries > 0 && (
                          <span className="text-xs text-orange-600">
                            Retry {job.retries}/{job.maxRetries}
                          </span>
                        )}
                      </div>
                    </div>

                    {job.error && (
                      <div className="text-xs text-red-600 bg-red-50 p-2 rounded mt-2">
                        Error: {job.error}
                      </div>
                    )}

                    {job.pdfUrl && (
                      <div className="mt-3">
                        <a
                          href={job.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                        >
                          <span className="mr-2">📄</span>
                          Download QA Report
                        </a>
                      </div>
                    )}

                    {job.screenshots && job.screenshots.length > 0 && (
                      <div className="mt-3">
                        <div className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                          <span className="mr-1">📸</span>
                          Screenshots ({job.screenshots.length})
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {job.screenshots.slice(0, 6).map((url, index) => (
                            <a
                              key={index}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block hover:opacity-80 transition-opacity"
                            >
                              <img
                                src={url}
                                alt={`Screenshot ${index + 1}`}
                                className="w-full h-16 object-cover rounded border"
                              />
                            </a>
                          ))}
                        </div>
                        {job.screenshots.length > 6 && (
                          <div className="text-xs text-gray-500 mt-1">
                            +{job.screenshots.length - 6} more screenshots
                          </div>
                        )}
                      </div>
                    )}

                    {job.aiAnalysis && (
                      <div className="mt-3 bg-gray-50 p-3 rounded">
                        <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                          <span className="flex items-center">
                            <span className="mr-1">🤖</span>
                            AI Analysis
                          </span>
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              job.aiAnalysis.status === "Approved"
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {job.aiAnalysis.status}
                          </span>
                        </div>

                        {job.aiAnalysis.scores && (
                          <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                            <div>
                              Silhouette: {job.aiAnalysis.scores.silhouette}%
                            </div>
                            <div>
                              Proportion: {job.aiAnalysis.scores.proportion}%
                            </div>
                            <div>
                              Color/Material:{" "}
                              {job.aiAnalysis.scores.colorMaterial}%
                            </div>
                            <div>Overall: {job.aiAnalysis.scores.overall}%</div>
                          </div>
                        )}

                        {job.aiAnalysis.differences.length > 0 && (
                          <div className="mb-2">
                            <div className="text-xs font-medium text-gray-600 mb-1">
                              Issues Found ({job.aiAnalysis.differences.length}
                              ):
                            </div>
                            {job.aiAnalysis.differences
                              .slice(0, 3)
                              .map((diff, index) => (
                                <div
                                  key={index}
                                  className="text-xs text-gray-700 mb-1"
                                >
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full mr-1 ${
                                      diff.severity === "high"
                                        ? "bg-red-500"
                                        : diff.severity === "medium"
                                        ? "bg-yellow-500"
                                        : "bg-green-500"
                                    }`}
                                  ></span>
                                  {diff.issues[0]}
                                </div>
                              ))}
                            {job.aiAnalysis.differences.length > 3 && (
                              <div className="text-xs text-gray-500">
                                +{job.aiAnalysis.differences.length - 3} more
                                issues
                              </div>
                            )}
                          </div>
                        )}

                        <div className="text-xs text-gray-600">
                          {job.aiAnalysis.summary.slice(0, 150)}
                          {job.aiAnalysis.summary.length > 150 && "..."}
                        </div>
                      </div>
                    )}

                    {job.processingLogs && job.processingLogs.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                          View Processing Logs ({job.processingLogs.length})
                        </summary>
                        <div className="mt-1 bg-gray-50 p-2 rounded text-xs max-h-32 overflow-y-auto">
                          {job.processingLogs.map((log, index) => (
                            <div key={index} className="text-gray-700">
                              {log}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Test Actions */}
        <div className="mt-6 bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4">Test Actions</h3>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => window.open("/api/status-change", "_blank")}
              className="flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              <span className="mr-2">🔗</span>
              View Status API
            </button>
            <button
              onClick={() => window.open("/api/queue", "_blank")}
              className="flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              <span className="mr-2">🔗</span>
              View Queue API
            </button>
            <button
              onClick={() => window.open("/api/download-glb", "_blank")}
              className="flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              <span className="mr-2">⬇️</span>
              Test GLB Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QAMonitorDashboard;
