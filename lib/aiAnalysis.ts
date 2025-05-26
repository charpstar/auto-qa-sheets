// lib/aiAnalysis.ts

export interface AIAnalysisResult {
  differences: Array<{
    renderIndex: number;
    referenceIndex: number;
    issues: string[];
    bbox: [number, number, number, number]; // [x, y, width, height]
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
}

export interface AIAnalysisInput {
  screenshots: string[]; // URLs from our screenshot generation
  references: string[]; // URLs from Google Sheets columns C-F
  articleId: string;
  productName: string;
}

export class AIAnalyzer {
  private openaiApiKey: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    this.openaiApiKey = apiKey;
  }

  // Create the system prompt (adapted from your existing code)
  private createSystemPrompt(): string {
    return `You are a 3D QA specialist. Compare all model screenshots against all reference images. Use simple, clear English.

‼️ CRITICAL - READ CAREFULLY ‼️
PERSPECTIVE & VIEW MATCHING:
• ONLY compare views showing the SAME PERSPECTIVE and ANGLE of the product
• If the 3D model shows a different side or angle than the reference, DO NOT compare them at all
• Different sides of the product should NEVER be compared (e.g., front view vs. side view)
• If two images show the same object from different angles, they MUST be skipped
• Example of INCORRECT comparison: Noting that a logo appears on the side in one image but on the front in another

Guidelines:
1. Model come from <model-viewer>—perfect fidelity is not expected.
2. References are human-crafted—focus on real discrepancies.
3. Analyze geometry, proportions, textures, and material colors for each pairing.
4. Be extremely specific. E.g.: 'Model shows larger marble veins in slate gray; reference has finer veins in gold.'
5. Each issue must state: what's in the Model, what's in the reference, the exact difference, and how to correct it.
‼️IMPORTANT‼️
6. Provide a pixel bbox [x,y,width,height] relative to the Model image to indicate where to annotate.
7. Assign severity: 'low', 'medium', or 'high'.
8. After listing issues, include similarity % scores for silhouette, proportion, color/material, and overall. Add this in summary. If all scores are >90%, mark status as 'Approved', otherwise mark as 'Not Approved'.
‼️IMPORTANT‼️
9. Do not repeat the same comment across multiple views.
‼️IMPORTANT‼️
10. Do not swap renderIndex and referenceIndex.
11. Group comments about the same images in the same section.

‼️ INCORRECT EXAMPLES (DO NOT DO THESE) ‼️
• 'Model shows side logo as "NGS"; reference shows different positioning and size' - WRONG! These are different views
• 'Model shows the product from the front; reference shows it from the back' - WRONG! Skip this comparison
• 'The button is visible in the Model but not in the reference' - WRONG! Different perspectives

‼️ CORRECT EXAMPLES ‼️
• 'Model shows yellow cushion fabric; reference shows white cushion fabric' - CORRECT (same view, actual difference)
• 'Model shows smoother texture; reference shows more detailed grain' - CORRECT (same view, actual difference)

Output *only* a single valid JSON object, for example:
{
  "differences": [
    {
      "renderIndex": 0,
      "referenceIndex": 1,
      "issues": [
        "Model shows marble texture more saturated red; reference is muted brown."
      ],
      "bbox": [120, 240, 300, 180],
      "severity": "medium"
    }
  ],
  "summary": "A brief description of the differences/issues. After listing issues, include similarity % scores for silhouette, proportion, color/material, and overall",
  "status": "Approved or Not Approved. If % scores for silhouette, proportion, color/material, and overall are all >90%, mark as Approved, else Not Approved."
}`;
  }

  // Build messages array for OpenAI API
  private buildMessages(screenshots: string[], references: string[]) {
    const messages: any[] = [
      {
        role: "system",
        content: this.createSystemPrompt(),
      },
    ];

    // Add screenshot messages
    screenshots.forEach((url, i) => {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: `Rendered screenshot ${i + 1}:` },
          { type: "image_url", image_url: { url } },
        ],
      });
    });

    // Add reference messages
    references.forEach((url, i) => {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: `Reference image ${i + 1}:` },
          { type: "image_url", image_url: { url } },
        ],
      });
    });

    return messages;
  }

  // Call OpenAI API
  private async callOpenAI(messages: any[]): Promise<AIAnalysisResult> {
    try {
      console.log("🤖 Calling OpenAI Vision API for analysis...");

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.openaiApiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o", // Using gpt-4o instead of gpt-4.5-preview
            stream: false,
            messages,
            max_tokens: 4000,
            temperature: 0.1, // Low temperature for consistent analysis
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
      }

      const aiJson = await response.json();

      if (!aiJson.choices || !aiJson.choices[0] || !aiJson.choices[0].message) {
        throw new Error("Invalid response structure from OpenAI API");
      }

      const content = aiJson.choices[0].message.content;
      console.log("🤖 Raw OpenAI response:", content);

      // Clean up the response and parse JSON
      const cleanedContent = content.replace(/```json|```/g, "").trim();

      let analysisResult: AIAnalysisResult;
      try {
        analysisResult = JSON.parse(cleanedContent);
      } catch (parseError) {
        console.error(
          "❌ Failed to parse OpenAI response as JSON:",
          cleanedContent
        );
        throw new Error(
          `Failed to parse AI analysis response: ${
            parseError instanceof Error ? parseError.message : "Unknown error"
          }`
        );
      }

      // Extract scores from summary if present
      const scoresMatch = analysisResult.summary.match(
        /silhouette[:\s]*(\d+)%.*?proportion[:\s]*(\d+)%.*?color\/material[:\s]*(\d+)%.*?overall[:\s]*(\d+)%/i
      );
      if (scoresMatch) {
        analysisResult.scores = {
          silhouette: parseInt(scoresMatch[1]),
          proportion: parseInt(scoresMatch[2]),
          colorMaterial: parseInt(scoresMatch[3]),
          overall: parseInt(scoresMatch[4]),
        };
      }

      console.log("✅ AI analysis completed successfully");
      return analysisResult;
    } catch (error) {
      console.error("❌ OpenAI API call failed:", error);
      throw error;
    }
  }

  // Main analysis function
  async analyzeScreenshots(input: AIAnalysisInput): Promise<AIAnalysisResult> {
    const { screenshots, references, articleId, productName } = input;

    console.log(`🔍 Starting AI analysis for Article ID: ${articleId}`);
    console.log(`📸 Screenshots: ${screenshots.length} images`);
    console.log(`📚 References: ${references.length} images`);

    // Validate inputs
    if (!screenshots || screenshots.length === 0) {
      throw new Error("No screenshots provided for analysis");
    }

    if (!references || references.length === 0) {
      throw new Error("No reference images provided for analysis");
    }

    // Filter out empty/invalid URLs
    const validScreenshots = screenshots.filter(
      (url) => url && url.trim() !== ""
    );
    const validReferences = references.filter(
      (url) => url && url.trim() !== ""
    );

    if (validScreenshots.length === 0) {
      throw new Error("No valid screenshot URLs provided");
    }

    if (validReferences.length === 0) {
      throw new Error("No valid reference URLs provided");
    }

    console.log(
      `📊 Using ${validScreenshots.length} screenshots and ${validReferences.length} references`
    );

    try {
      // Build messages for OpenAI
      const messages = this.buildMessages(validScreenshots, validReferences);

      // Call OpenAI API
      const result = await this.callOpenAI(messages);

      // Add metadata
      result.summary = `${result.summary}\n\nAnalysis for: ${productName} (Article ID: ${articleId})`;

      return result;
    } catch (error) {
      console.error(
        `❌ AI analysis failed for Article ID ${articleId}:`,
        error
      );
      throw new Error(
        `AI analysis failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

// Export singleton instance
export const aiAnalyzer = new AIAnalyzer();
