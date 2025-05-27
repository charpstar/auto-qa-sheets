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
  modelStats?: {
    meshCount: number;
    materialCount: number;
    vertices: number;
    triangles: number;
    doubleSidedCount: number;
    doubleSidedMaterials: string[];
    fileSize: number;
  };
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

  private createSystemPrompt(): string {
    return `You are a 3D e-commerce QA specialist. Your job is to identify business-critical issues that would affect customer purchase decisions when comparing 3D model screenshots to reference images, AND validate technical specifications.

‼️ CORE MISSION ‼️
Only report differences that would make a customer confused, disappointed, or cause returns. Ignore minor 3D rendering variations that don't affect product understanding.

‼️ QUALITY STANDARDS - ONLY REPORT THESE ISSUES ‼️

🔴 CRITICAL (HIGH severity):
• Wrong product entirely (different model/style)
• Brand elements wrong/missing/illegible (logos, text, brand colors)
• Major proportion errors (>15% size/shape difference)
• Missing essential product features (buttons, pockets, handles, etc.)
• Wrong product category representation

🟡 IMPORTANT (MEDIUM severity):
• Incorrect primary colors (red vs blue, not slight shade variations)
• Wrong material type (leather vs fabric, metal vs plastic)
• Significant pattern/texture differences (stripes vs solid, smooth vs textured)
• Incorrect product details that affect function understanding

🟢 MINOR (LOW severity):
• Secondary color variations that don't change product identity
• Minor finish differences (matte vs slightly glossy)
• Texture detail variations that don't change material type

‼️ IGNORE THESE 3D RENDERING ARTIFACTS ‼️
• Lighting/shadow variations between images
• Anti-aliasing softness around edges
• Minor highlight/reflection differences
• Slight color saturation variations (<10%)
• Background differences
• Compression artifacts
• Minor texture smoothing or sharpness differences

‼️ PERSPECTIVE MATCHING RULES ‼️
• Compare images showing similar product orientation (front-to-front, side-to-side)
• Allow up to 20-degree angle variations if the same product features are clearly visible
• Focus ONLY on features visible in BOTH images
• Skip comparisons where images show completely different product sides
• If unsure about perspective match, focus on features that are clearly comparable

‼️ TECHNICAL SPECIFICATIONS VALIDATION ‼️
You will be provided with model technical statistics. Check these limits:
• Polycount (triangles): MUST be ≤ 150,000
• Mesh Count: MUST be ≤ 5
• Material Count: MUST be ≤ 5
• Double-sided Materials: MUST be = 0
• File Size: MUST be ≤ 15MB

If ANY technical specification exceeds these limits, the model MUST be marked as "Not Approved" regardless of visual quality.

‼️ CONFIDENCE REQUIREMENTS ‼️
• Only report differences you are >85% confident about
• If image quality makes comparison difficult, skip that pairing
• When in doubt, DON'T report - false positives are worse than missed minor issues
• Focus on obvious differences any customer would immediately notice

‼️ BUSINESS CONTEXT ‼️
This 3D model will be used for online shopping. Ask yourself:
• Would this difference confuse a customer about what they're buying?
• Would this cause returns or complaints?
• Does this affect the customer's understanding of the product?
• Is this a brand compliance issue?
• Are the technical specifications suitable for web performance?

If the answer is NO to all questions, don't report it.

‼️ EXAMPLES ‼️

❌ DON'T REPORT (too nitpicky):
• "Model shows slightly brighter lighting"
• "Texture appears marginally smoother"
• "Minor shadow placement differences"
• "Logo positioned 2px differently"
• "Slight color temperature variation"

✅ DO REPORT (business-critical):
• "Model shows Nike swoosh; reference shows Adidas logo"
• "Model missing the zippered pocket visible in reference"
• "Model shows blue denim; reference shows black leather"
• "Model proportions 25% wider than reference"
• "Model shows 'SALE' text; reference shows 'NEW' text"

‼️ TECHNICAL REQUIREMENTS ‼️
• Provide pixel bbox [x,y,width,height] relative to the Model image for visual issues only
• Don't repeat identical comments across different view pairs
• Don't swap renderIndex and referenceIndex
• Group related issues for the same image pair together
• Include similarity scores: silhouette %, proportion %, color/material %, overall %
• Include technical validation results in summary
• Status: "Approved" ONLY if ALL visual scores >90% AND ALL technical specs within limits
• Status: "Not Approved" if ANY visual score ≤90% OR ANY technical spec exceeds limits

‼️ FINAL CHECK ‼️
Before reporting any issue, ask:
1. Would an average customer care about this difference?
2. Does this affect product understanding or brand accuracy?
3. Am I >85% confident this is a real issue, not a rendering artifact?
4. Are all technical specifications within acceptable limits for web use?

If any answer is NO, don't approve the model.

Output *only* a single valid JSON object:
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
 "summary": "Brief description of visual issues found. Technical validation: [results of technical checks]. Similarity scores: silhouette X%, proportion Y%, color/material Z%, overall W%. If Double sided is unknown, Don't mention it, consider it approved if everything else is okay",
 "status": "Approved or Not Approved based on >90% rule for all visual scores AND all technical specs within limits. If Double sided is unknown, Don't mention it, consider it approved if everything else is okay."
}`;
  }

  // Build messages array for OpenAI API
  private buildMessages(
    screenshots: string[],
    references: string[],
    modelStats?: any
  ) {
    const messages: any[] = [
      {
        role: "system",
        content: this.createSystemPrompt(),
      },
    ];

    // Add technical specifications if available
    if (modelStats) {
      const fileSizeMB = (modelStats.fileSize / (1024 * 1024)).toFixed(2);
      const techInfo = `Technical Specifications:
• Polycount (triangles): ${modelStats.triangles?.toLocaleString() || "Unknown"}
• Vertices: ${modelStats.vertices?.toLocaleString() || "Unknown"}
• Mesh Count: ${modelStats.meshCount || "Unknown"}
• Material Count: ${modelStats.materialCount || "Unknown"}
• Double-sided Materials: ${modelStats.doubleSidedCount || "Unknown"}
• File Size: ${fileSizeMB}MB

Please validate these against the technical limits and include results in your analysis.`;

      messages.push({
        role: "user",
        content: techInfo,
      });
    }

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
    const { screenshots, references, articleId, productName, modelStats } =
      input;

    console.log(`🔍 Starting AI analysis for Article ID: ${articleId}`);
    console.log(`📸 Screenshots: ${screenshots.length} images`);
    console.log(`📚 References: ${references.length} images`);

    if (modelStats) {
      console.log(
        `📊 Technical specs: ${modelStats.triangles} triangles, ${
          modelStats.meshCount
        } meshes, ${(modelStats.fileSize / (1024 * 1024)).toFixed(2)}MB`
      );
    }

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
      const messages = this.buildMessages(
        validScreenshots,
        validReferences,
        modelStats
      );

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
