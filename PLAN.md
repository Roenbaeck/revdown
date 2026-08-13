# PLAN
This plan was created in a discussion with an LLM, based on my ideas, and needs to be revised into a proper plan.

---
Is there a good markdown renderer repo that I could possibly start with for a new project? I would like a markdown reader (not editor) that does not alter an existing markdown file, but in which you can select sections of text and provide comments. It would be great if comments were visibly accessible, readable, and editable once there. Comments are saved in a file alongside the original markdown document, in some text format, maybe also markdown. I'd then like to be able to take the contents of that text formatted save of comments, feed that to an LLM along with the original markdown, and the LLM should understand exactly what orignal text was commented and be able to read the comment itself. 

I think this would be very useful in my workflow with LLMs, where they often produce large markdown files, and I want to provide feedback on them. Right now I have to do so in an editor and intermix comments with text, which is both risky, alters the original text, and consumes more tokens than necessary when I return the commented file to the LLM. 

What do you think of the idea? What existing tech could give me a good start? Ideally I'd like to be able to run this on macOS and Windows, with very good performance, and with rendering of both code and math. Basically the same capabilities an LLM uses when rendering a response.
---
### Thoughts on the Idea

**Your idea is fantastic.** It essentially creates a **GitHub Pull Request review interface specifically tailored for local Markdown files and LLM workflows.**

Here is why this workflow makes complete sense:
1. **Non-Destructive & Token-Efficient:** By keeping comments in a sidecar file rather than embedding HTML comments (`<!-- comment -->`) or inline brackets into the main file, you preserve the exact output from the LLM without risk of syntax corruption. Sending a clean sidecar format to the LLM consumes significantly fewer tokens than sending a giant file filled with inline annotations.
2. **Contextual Precision:** Providing the target string/quote alongside the line numbers or offset anchors gives the LLM unambiguous context on what needs changing.
3. **Reproducibility:** You can maintain a history of LLM iterations (e.g., `v1.md`, `v1.comments.md`, leading to `v2.md`).

---

### Key Tech Stack & Starter Architectures

To get **high performance**, **cross-platform support (macOS & Windows)**, and **LLM-grade rendering (Math + Syntax Highlighting)**, here are the best starting paths.

---

#### Approach 1: Tauri + Web Tech (Recommended for a Standalone App)
If you want a lightweight, blazing-fast native desktop application without the memory overhead of Electron, **[Tauri](https://tauri.app/)** (Rust backend + Web frontend) is the gold standard.

*   **Framework:** Tauri (Rust handles native file I/O for saving sidecars; Webview renders the UI).
*   **Markdown Engine:** **[Unified / Remark / Rehype](https://github.com/remarkjs/remark)**
    *   *Why:* Unlike simple regex-based renderers, `remark` parses Markdown into a concrete Syntax Tree (AST). This makes calculating exact character offsets, block line numbers, and DOM nodes trivial when a user highlights text.
*   **Math Rendering:** **[rehype-katex](https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex)** (fast, standard KaTeX rendering, identical to ChatGPT/Claude).
*   **Code Highlighting:** **[Shiki](https://shiki.style/)** or **[rehype-highlight](https://github.com/rehypejs/rehype-highlight)**. Shiki uses VS Code's exact TextMate grammars for pixel-perfect syntax highlighting.
*   **Text Selection & Annotation Engine:**
    *   **[RecogitoJS](https://github.com/recogito/recogito-js)** or **[Apache Annotator](https://annotator.apache.org/)**: These libraries implement the W3C Web Annotation standard. They handle highlighted text selections, create robust selectors (exact quote + prefix + suffix), and can trigger comment overlays.

---

#### Approach 2: A VS Code Extension (The Ultimate "Shortcut")
Before writing a full app from scratch, consider that **VS Code already has a built-in Commenting API** (`vscode.comments`) and best-in-class Markdown/Math/Code rendering.

*   **How it works:** You write a lightweight extension. When opening a `.md` file, the extension reads the adjacent `.comments.json` or `.comments.md` file and renders native comment threads right in the gutter (just like GitHub PR comments).
*   **Pros:** 
    *   Zero UI rendering logic to write (VS Code handles line rendering, math via extensions, syntax highlighting, and text selection natively).
    *   Cross-platform out of the box (macOS/Windows/Linux/Web).
    *   You only write ~200 lines of TypeScript glue code to handle comment creation and sidecar read/write.

---

### Starter Repositories / Templates

If you choose to build a standalone desktop app, here are great open-source starting templates:

1. **[Tauri + React + Tailwind Starter](https://github.com/tauri-apps/tauri)**
   * Set up a Tauri app with a React frontend. You can install `react-markdown`, `remark-math`, `rehype-katex`, and `shiki`.
2. **[MarkText](https://github.com/marktext/marktext)** *(Reference Repo)*
   * An open-source real-time Markdown editor/viewer built on Electron and `markdown-it`. While it's an editor, its rendering pipeline (KaTeX, PrismJS) and block-structure handling are great code references.
3. **[Milkdown](https://milkdown.dev/)**
   * A plugin-driven, headless WYSIWYG/Markdown engine based on ProseMirror and Remark. Even in read-only mode, its plugin architecture makes inline annotations and selection popups simple to build.

---

### Recommended Sidecar Format for LLMs

To make the sidecar file easily parsable by LLMs, use **Markdown with YAML/JSON metadata** or structured Markdown with blockquotes. 

LLMs excel at parsing both YAML and Markdown context blocks.

#### Option A: Clean Markdown (Token Efficient)
```markdown
# Feedback for draft.md

### Comment 1
- **Line Range:** 12–14
- **Target Text:** 
> "The engine uses a deterministic state machine to process events."
- **Feedback:** Clarify what happens if an unhandled event enters the queue.

---

### Comment 2
- **Line Range:** 45–45
- **Target Text:** `$E = mc^2$`
- **Feedback:** Explain the variables in the math section below this equation.
```

#### Option B: JSON / YAML Sidecar (`draft.md.comments.json`)
```json
[
  {
    "id": "c1",
    "target_quote": "The engine uses a deterministic state machine to process events.",
    "context_prefix": "In this architecture, ",
    "context_suffix": " All transitions are logged.",
    "line_start": 12,
    "line_end": 14,
    "comment": "Clarify what happens if an unhandled event enters the queue."
  }
]
```

*Note on Robustness:* Storing the `target_quote` alongside `context_prefix` and `context_suffix` (W3C Text Quote Selector standard) ensures that even if the original file changes slightly, your app and the LLM can still anchor the comment to the exact spot.

---

### Prompting Strategy for the LLM

When feeding both files back to an LLM, you can use a prompt template like this:

> **Prompt:**
> "I am providing an original document (`DOCUMENT.md`) and a set of inline review comments (`COMMENTS.md`). 
> Please update `DOCUMENT.md` by addressing each comment in `COMMENTS.md`. Do not modify sections of text that do not have comments associated with them."

---
Let's assume I go with the markdown sidecar. Like you say, the original document can evolve independently of the sidecar. Would it be possible to add some form of "hash" to the sidecar, from which it would be possible to determine how much the document the sidecar was based on has deviated from a current one? This would give the LLM an idea of how likely it is that comments will be matchable to precise locations or text. Perhaps the markdown format could contain more ways to find what was originally commented? This is an edge case of course, and most of the times I expect the hash to be identical.
---

Handling "document drift"—where the source document changes while the sidecar comments stay the same—is a classic challenge in annotation and code-review systems. 

Adding hashing and multi-layered anchors directly into the Markdown sidecar is a great solution. It allows both your desktop application and the receiving LLM to instantly gauge confidence, locate displaced comments, and handle edge cases gracefully.

---

### 1. Document Hashing Strategies for Drift Detection

You can add a **YAML Frontmatter** block at the top of the Markdown sidecar file. This separates global document metadata from individual comments.

#### Level A: Global Document Hash (Fastest Check)
* **What it is:** A standard SHA-256 hash of the entire original `.md` document when the comments were generated.
* **How it works:** When your app opens `document.md` and `document.comments.md`, it re-calculates the SHA-256 of `document.md`.
  * **Hash matches:** 100% confidence. No drift. Line numbers and offsets are exact.
  * **Hash differs:** Drift detected. Fall back to local search strategies.

#### Level B: Block-Level Hashes (Granular Check)
* **What it is:** A hash of *just the specific paragraph or block element* being commented on.
* **Why it’s powerful:** If a user adds 5 new paragraphs at the top of the document, the global document hash will change, but the block hash for a paragraph at the bottom will remain identical. The system knows with 100% certainty that the target text itself was not edited, only moved.

#### Level C: Similarity Score / Diff Metric
If you want to inform the LLM how much the document drifted overall, your desktop app can calculate a quick **Levenshtein distance** or **Diff ratio** (e.g., using `diff-match-patch`) between the original document state and the current state, writing a `drift_score` to the metadata:
* `drift_score: 0%` (Identical)
* `drift_score: 5%` (Minor edits, high match confidence)
* `drift_score: 40%` (Major refactoring, fuzzy matching required)

---

### 2. Multi-Layered Anchoring (How to reliably locate text)

To make sure a comment can *always* be mapped back to its target—even if line numbers shift or minor typos are fixed—you should use a **3-part anchoring system** in the sidecar:

1. **Structural Anchor (AST Path):** Markdown headings create a logical hierarchy. E.g., `# Architecture > ## Event Loop > Paragraph 2`.
   * *Resilience:* Line numbers change easily, but structural AST positions rarely break unless the whole section is renamed or deleted.
2. **Contextual Anchor (W3C Quote + Prefix + Suffix):** Include a few words before and after the selection.
   * *Resilience:* If the exact target string appears multiple times in the document (e.g., `const x = 1;`), the prefix/suffix surrounding it makes it globally unique.
3. **Exact Quote:** The target text.

---

### 3. Example Markdown Sidecar File Schema

Here is what a complete, token-efficient, drift-resistant Markdown sidecar file looks like:

```markdown
---
target_file: architecture_doc.md
target_sha256: 8f4e2a1b9c3d...
created_at: 2026-08-13T10:00:00Z
drift_score: 0%  # Updated dynamically by your app if files diverge
---

# Feedback for architecture_doc.md

## Comment 1
- **Target ID:** comment-001
- **AST Path:** `# System Overview > ## Data Flow > p[2]`
- **Block SHA256:** a1b2c3d4...
- **Line Hint:** 42-44
- **Context:**
  - **Prefix:** `...when receiving incoming payload, `
  - **Target:** `the engine uses a deterministic state machine to process events.`
  - **Suffix:** ` All state transitions are written to...`
- **Feedback:** Clarify what happens if an unhandled event enters the queue during a state transition.

---

## Comment 2
- **Target ID:** comment-002
- **AST Path:** `# API Reference > ## Endpoints`
- **Block SHA256:** e5f6g7h8...
- **Line Hint:** 89-89
- **Context:**
  - **Target:** `POST /v1/process`
- **Feedback:** Change this endpoint to `PUT` since it is idempotent.
```

---

### 4. How the LLM Uses This Metadata

When sending this sidecar to an LLM alongside the current document, the LLM will automatically adapt its search behavior based on the metadata:

* **If `target_sha256` matches:** The LLM knows it can trust line hints and exact character matches blindly.
* **If `target_sha256` differs, but `Block SHA256` or `Context` is provided:** You can include a simple instruction in your system prompt:

> **System Prompt Rule for Drift:**
> *"If `target_sha256` indicates document drift, do not rely on line numbers. Instead, find the commented text by matching the `AST Path` heading hierarchy and the `Context (Prefix + Target + Suffix)` block. If the target text was slightly modified in the source file, locate the closest semantic match."*

Because modern LLMs (Claude, GPT-4, Llama 3) have strong fuzzy matching and context understanding capabilities, giving them the `Prefix + Target + Suffix` context triplet guarantees near-100% accuracy in locating dislocated comments.

---
Rather than having to discipline users to provide a good prompt alongside the document and the sidecar when feeding it back to the LLM, would it be possible to add the prompt in the frontmatter of the sidecar? Would an LLM respect that?
---

**Yes, absolutely.** Including the prompt/instructions directly in the sidecar’s YAML frontmatter is a brilliant UX pattern. 

Modern instruction-tuned LLMs (GPT-4o, Claude 3.5 Sonnet, Llama 3) treat frontmatter as high-priority structural context. They are very adept at recognizing metadata keys like `instructions:` or `system_prompt:` and executing them natively.

Whether a user is using your app’s automated API integration or literally copy-pasting raw text into the ChatGPT/Claude web interface, putting the prompt in the frontmatter works reliably for two key reasons:

---

### How It Works in Both Usage Scenarios

#### Scenario A: Manual Copy-Paste into Chat Interfaces (Web UI)
If a user simply drags and drops `document.md` and `document.comments.md` into ChatGPT or Claude without typing a word:
1. The LLM reads the top of `document.comments.md`.
2. It sees the structured YAML frontmatter declaring the task, role, and output format.
3. Because instruction-tuned models pay heavy attention to structured top-level metadata, the LLM will adopt the persona and execute the task automatically.

#### Scenario B: Automated via Your Desktop App (API Calls)
If your desktop app handles the LLM call via API (OpenAI, Anthropic, Ollama, etc.):
1. Your app parses the YAML frontmatter of the sidecar file.
2. It extracts the `system_instructions` field and passes it cleanly into the API's official `system` parameter.
3. The remaining body of the sidecar + the original document are passed as the `user` message.

---

### Recommended Frontmatter Schema with Embedded Prompt

Here is how you can structure the sidecar frontmatter so that it acts as a self-contained, auto-executing prompt:

```markdown
---
target_file: architecture_doc.md
target_sha256: 8f4e2a1b9c3d...

# Embedded LLM Instructions
task: revise_document
role: Expert Technical Editor
instructions: >
  You are an expert technical writer and editor. Your task is to update the target document 
  based on the inline feedback comments provided in this sidecar file.
  
  Rules:
  1. Only modify sections of the target document that correspond to the provided comments.
  2. Keep all un-commented text, structure, and formatting completely untouched.
  3. Match target text using the provided `AST Path` and `Context (Prefix + Target + Suffix)` 
     if line numbers have shifted.
  4. Return ONLY the fully revised Markdown document as your output. Do not include introductory 
     or concluding conversational text.

---

# Feedback for architecture_doc.md

## Comment 1
- **Target ID:** comment-001
- **AST Path:** `# System Overview > ## Data Flow > p[2]`
- **Context:**
  - **Prefix:** `...when receiving incoming payload, `
  - **Target:** `the engine uses a deterministic state machine to process events.`
  - **Suffix:** ` All state transitions are written to...`
- **Feedback:** Clarify what happens if an unhandled event enters the queue during a state transition.
```

---

### Why This Design is Extremely Effective

1. **Zero Friction for End-Users:** The user never has to remember "What was that good prompt I used last time?" The sidecar file is completely self-describing.
2. **Version Control for Prompts:** As you refine your app's prompt engineering over time to get better results, you can update the template used when creating new sidecar files. Old sidecars retain their original prompts, ensuring reproducible results.
3. **Customizable per Project:** A user could edit the `instructions:` block in a specific sidecar if they want a special tone (e.g., *"Rewrite these sections to be more concise"* or *"Expand heavily on the code examples in these feedback points"*).

---
I think it's dangerous to assume a role like "Expert Technical Editor", since we have no idea what the original document contains. A better instruction would be that it should adapt a role that fits the purpose and stay true to the original style of writing, unless a comment specifically changes that directive.
---

You are 100% right. Hardcoding a role like "Expert Technical Editor" imposes an assumption about the document's domain. If the document is a fantasy novel chapter, a legal contract, a personal blog post, or a marketing pitch, telling the LLM to behave like a "Technical Editor" will cause it to flatten the author's unique voice or rewrite creative prose into rigid, corporate prose.

A far better approach is to instruct the LLM to **infer and adapt to the target document's domain and style**, making style-preservation the default rule, while allowing individual comments to act as explicit overrides.

---

### Revised Domain-Agnostic Frontmatter Schema

Here is how the prompt instruction in the sidecar frontmatter should look to handle *any* type of document:

```markdown
---
target_file: draft.md
target_sha256: 8f4e2a1b9c3d...

task: apply_inline_feedback
instructions: >
  You are an adaptive document reviewer. Your goal is to apply the feedback comments 
  in this sidecar file to the original target document.

  Rules for Revision:
  1. Style & Voice Preservation: Automatically adapt your tone, vocabulary, and writing style 
     to match the purpose and domain of the original document. Preserve the author's unique 
     voice throughout your revisions.
  2. Comment Directive Hierarchy: Treat specific inline comments as local overrides. If a comment 
     explicitly requests a change in tone, formatting, or style (e.g., "make this more formal" 
     or "simplify this explanation"), follow the comment's directive for that specific section.
  3. Scope Constraint: Revise ONLY the sections targeted by comments. Leave all un-commented 
     text, structure, and formatting completely untouched.
  4. Matching Resilience: Locate target text using the provided AST Path and Context 
     (Prefix + Target + Suffix) if line numbers or exact wording have drifted slightly.
  5. Output Format: Output ONLY the complete, updated Markdown document. Do not include any 
     conversational preamble, explanation, or postscript.
---

# Feedback for draft.md

## Comment 1
- **Target ID:** comment-001
- **AST Path:** `# Chapter 1 > p[3]`
- **Context:**
  - **Prefix:** `...the shadows lengthened across the valley, `
  - **Target:** `he felt a sudden chill that rattled his very bones.`
  - **Suffix:** ` No one had warned him about the night air...`
- **Feedback:** Make this description more visceral and atmospheric, but keep the suspenseful tone.
```

---

### Why This Design Works Much Better

1. **Leverages In-Context Learning:** LLMs are exceptionally good at "style-matching" (inferring the register, sentence structure, and vocabulary density of text provided in the prompt). Telling it to infer the style from the original file taps directly into this core strength.
2. **Clear Hierarchy of Intent:** By explicitly telling the LLM: `Original Document Style` $\rightarrow$ `Overridden by Inline Comment`, you eliminate ambiguity when a comment intentionally asks for a stylistic shift (e.g., changing a complex paragraph into a simple bulleted list).
3. **Domain Agnostic:** The exact same software and sidecar template can now be used by a fiction writer, a software engineer writing docs, a lawyer reviewing a contract, or a student writing an essay.

---
Do you think those instructions explain the sidecar format sufficiently and efficiently? Ideally, the LLM will know how to parse the format from reading the instructions along.
---

They are **about 85% of the way there**. 

Because modern LLMs are intelligent, they would *probably* figure out that `Target:` means "text to find" and `Feedback:` means "what to do." However, relying on the LLM's implicit intuition leaves room for edge-case errors—such as the LLM confusing the `Prefix` with text it should edit, or missing where the comment payload actually lives.

To make the format **100% self-explaining and foolproof**, the instructions should briefly and explicitly define the **Sidecar Schema** (mapping the keys to their meaning) alongside the **Execution Rules**.

---

### What Was Missing / Ambiguous

1. **Explicit Key-to-Action Binding:** The LLM wasn't explicitly told that `Feedback:` is the instruction and `Context.Target` is the subject.
2. **File Boundary Clarity:** If a user pastes both the target document and the sidecar into a single chat window, the LLM needs to know how to distinguish the sidecar's comments from the original document's text.

---

### The Optimized, Ultra-Efficient Instructions Block

Here is the refined instruction set. It adds explicit parsing rules in just **5 extra lines**, making the sidecar completely self-documenting without wasting tokens:

```markdown
---
target_file: draft.md
target_sha256: 8f4e2a1b9c3d...

task: apply_inline_feedback
instructions: >
  You are an adaptive document editor. Apply the review comments in this sidecar file 
  to the attached target document.

  SIDECAR PARSING RULES:
  - Each edit task is defined under a `## Comment [N]` section.
  - LOCATE: Find the text in the target document matching `Context.Target`. Use `Prefix`, 
    `Suffix`, and `AST Path` to disambiguate identical or displaced text.
  - APPLY: Execute the instruction given in `Feedback:` on the matched text.

  EXECUTION RULES:
  1. Style: Match the target document's tone, domain, and writing style, unless `Feedback:` 
     explicitly requests a style change.
  2. Scope: Revise ONLY the targeted text. Leave all un-commented content completely untouched.
  3. Output: Return ONLY the complete, updated target document in Markdown. No preamble or explanations.
---
```

---

### Why This Refinement Guarantees Success

1. **Zero Guesswork for Key Names:** By explicitly linking `LOCATE` $\rightarrow$ `Context.Target` and `APPLY` $\rightarrow$ `Feedback:`, the LLM has a clear algorithm to follow: *Find X, apply Y*.
2. **Explicit Disambiguation Strategy:** Telling it explicitly that `Prefix` and `Suffix` exist to *disambiguate* prevents the LLM from accidentally modifying the prefix or suffix text.
3. **Extremely Compact:** The entire instruction set is roughly **140 words**. It adds virtually no overhead to your token budget while giving the LLM complete parsing deterministic clarity.

---
I see two issues here. We are assuming perfectly disciplined users. First, I think "Revise ONLY" is too strong, since a user may have marked some text for commenting where also the surrounding text may need to change in order for the change to make sense or flow naturally. Secondly, the "Return ONLY" assumes a workflow with cut and pase into an LLM web interface. This could be run in Agent mode within Codex, Claude Code, or Antigravity, where it would make more sense that the original file resides in a repo and is altered, after which the Agent can summarize what it did. Perhaps it couldn't match some of the comments to the original text, at which point it would be very useful for the end user to get that information reported back to them. 
---

You've hit on two crucial real-world editing dynamics that single-turn web prompts completely break.

### Issue 1: The "Frankenstein Text" Problem (Over-constrained Scope)
If an LLM is strictly forbidden from touching surrounding text, replacing a phrase like *"the fast engine"* with *"the high-throughput, event-driven processing loop"* will create grammatically awkward, jarring transitions with the surrounding sentence. 

An editor *must* have permission to blend changes naturally into immediate context.

### Issue 2: Agentic Workflows vs. Single-Turn Copy-Pasting
Assuming a simple "paste text into web chat" model ignores modern software workflows. When running in **Agent Mode** (like Claude Code, Google's Antigravity, Cursor, or CLI agents):
1. **The Agent mutates the file on disk directly.** It doesn't print a giant Markdown file to stdout if it can just write to `draft.md`.
2. **Error & Drift Reporting is vital.** If `Comment 4` points to text that was deleted 3 commits ago, the Agent shouldn't silently hallucinate or guess—it needs to report: *"Applied 3 comments successfully. Could not match Comment 4."*

---

### The Updated, Agent-Aware Frontmatter Schema

Here is how we update the frontmatter instructions to accommodate **natural text blending**, **Agentic file-editing mode**, and **Drift/Failure Reporting**:

```markdown
---
target_file: draft.md
target_sha256: 8f4e2a1b9c3d...

task: apply_inline_feedback
instructions: >
  You are an adaptive document editor and agent. Apply the review comments in this 
  sidecar file to the specified target document.

  SIDECAR PARSING RULES:
  - Each task is defined under a `## Comment [N]` section.
  - LOCATE: Match `Context.Target` in the target document. Use `Prefix`, `Suffix`, 
    and `AST Path` to resolve displaced or ambiguous text.
  - APPLY: Execute the instructions in `Feedback:` on the matched region.

  REVISION & SCOPE RULES:
  - Contextual Blending: Primary edits must focus on the targeted region. However, you MAY 
    adjust immediate surrounding words, punctuation, or sentence structure if required 
    for correct grammar, natural voice, and smooth transitions.
  - Unrelated Content: Do not refactor or rewrite paragraphs that have no associated comments.

  EXECUTION & REPORTING:
  - Agent Mode (File-system access available): Apply edits directly to `target_file`. 
    Summarize actions taken in your final response.
  - Completion Mode (No file-system access): Output the complete, revised target document.
  - Unmatched / Ambiguous Comments Report: If any comment cannot be matched with high 
    confidence (due to severe document drift or deleted text), DO NOT guess blindly. 
    Explicitly list unmatched comments under an `Execution & Unmatched Comments Report` 
    so the user can manually address them.
---
```

---

### Why This Complete Design Works so Well

#### 1. Graceful Handling of Document Drift
If 1 out of 5 comments can't be matched because the original text was deleted, the LLM will output a clean report instead of breaking the build or hallucinating:

> **Execution & Unmatched Comments Report:**
> - ✅ **Comment 1 & 2:** Applied successfully in Section 1.
> - ✅ **Comment 3:** Applied in Section 3 (adjusted surrounding sentence for flow).
> - ⚠️ **UNMATCHED - Comment 4:** Target text `"the fast engine"` could not be found near `AST Path: # Performance`. Skipping edit.

#### 2. Native Compatibility with Coding Agents (Claude Code, Antigravity, etc.)
Agents will read `Agent Mode: Apply edits directly to target_file` and automatically trigger their file-editing tools (`str_replace_editor`, `write_file`), rather than dumping 2,000 lines of Markdown text into the terminal console.

#### 3. Natural Writing Quality
The `Contextual Blending` rule gives the model room to fix prepositions, conjunctions, and punctuation around the edit zone so the resulting prose reads like it was written by a single human author in one pass.

---
