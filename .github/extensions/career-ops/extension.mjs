import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();

function loadFile(relativePath) {
	const fullPath = join(cwd, relativePath);
	if (existsSync(fullPath)) {
		return readFileSync(fullPath, "utf-8");
	}
	return null;
}

const MODE_MAP = {
	oferta: "oferta",
	ofertas: "ofertas",
	contacto: "contacto",
	deep: "deep",
	pdf: "pdf",
	training: "training",
	project: "project",
	tracker: "tracker",
	pipeline: "pipeline",
	apply: "apply",
	scan: "scan",
	batch: "batch",
};

const JD_KEYWORDS = [
	"responsibilities",
	"requirements",
	"qualifications",
	"about the role",
	"we're looking for",
	"we are looking for",
	"job description",
	"what you'll do",
];

const DISCOVERY_MENU = `
career-ops — Command Center

Available commands:
  /career-ops {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /career-ops pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /career-ops oferta    → Evaluation only A-F (no auto PDF)
  /career-ops ofertas   → Compare and rank multiple offers
  /career-ops contacto  → LinkedIn power move: find contacts + draft message
  /career-ops deep      → Deep research prompt about company
  /career-ops pdf       → PDF only, ATS-optimized CV
  /career-ops training  → Evaluate course/cert against North Star
  /career-ops project   → Evaluate portfolio project idea
  /career-ops tracker   → Application status overview
  /career-ops apply     → Live application assistant (reads form + generates answers)
  /career-ops scan      → Scan portals and discover new offers
  /career-ops batch     → Batch processing with parallel workers

Inbox: add URLs to data/pipeline.md → /career-ops pipeline
Or paste a JD directly to run the full pipeline.
`;

function detectMode(input) {
	if (!input || input.trim() === "") return "discovery";

	const trimmed = input.trim().toLowerCase();
	const firstWord = trimmed.split(/\s+/)[0];

	if (MODE_MAP[firstWord]) return MODE_MAP[firstWord];

	// Check if it looks like a URL
	if (/^https?:\/\//.test(trimmed)) return "auto-pipeline";

	// Check if it looks like a JD
	const lower = trimmed;
	if (JD_KEYWORDS.some((kw) => lower.includes(kw))) return "auto-pipeline";

	return "discovery";
}

function needsShared(mode) {
	const standaloneList = ["tracker", "deep", "training", "project"];
	return !standaloneList.includes(mode);
}

const session = await joinSession({
	hooks: {
		onUserPromptSubmitted: async (input) => {
			const prompt = input.prompt || "";

			// Match /career-ops commands
			const match = prompt.match(/^\/?career-ops\s*(.*)/is);
			if (!match) return;

			const args = match[1].trim();
			const mode = detectMode(args);

			if (mode === "discovery") {
				return { modifiedPrompt: DISCOVERY_MENU };
			}

			// Build context from mode files
			let context = "";

			if (needsShared(mode)) {
				const shared = loadFile("modes/_shared.md");
				if (shared) context += shared + "\n\n";
			}

			// Load profile overrides
			const profile = loadFile("modes/_profile.md");
			if (profile) context += profile + "\n\n";

			const modeFile =
				mode === "auto-pipeline" ? "auto-pipeline" : mode;
			const modeContent = loadFile(`modes/${modeFile}.md`);
			if (modeContent) context += modeContent + "\n\n";

			// For auto-pipeline, pass the JD/URL as the task
			if (mode === "auto-pipeline") {
				context += `\n\nUser input (JD or URL to evaluate):\n${args}`;
			}

			return {
				additionalContext: context,
				modifiedPrompt:
					mode === "auto-pipeline"
						? `Evaluate this job opportunity using the auto-pipeline mode instructions provided in context: ${args}`
						: `Execute the career-ops ${mode} mode using the instructions provided in context. ${args}`,
			};
		},
	},
	tools: [],
});
