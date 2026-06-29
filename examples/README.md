# Example system prompts

This folder holds ready-to-use **system prompts** for Jotflow — plain Markdown
files that set the model's role, voice, and ground rules before your conversation
starts.

A *system prompt* is the instruction the model reads first, ahead of every
message you send. It doesn't show up in the chat; it just shapes how the model
answers. Swapping it turns the same model into a careful coding agent, a patient
mentor, or a sarcastic robot — without touching the model or your messages.

## How to use one

Each `.chat` file can pull in one or more of these via `systemPromptFiles`. Paths
are resolved **relative to the `.chat` file's own folder**:

```json
"systemPromptFiles": [
  { "path": "Yoda.md" }
]
```

You can stack several files — they're combined with the inline `systemPrompt`
field, in order. To try one, point a `.chat`'s `systemPromptFiles` at it (as shown
above) and start chatting.

> Tip: keep your own prompts as `.md` files anywhere in the workspace and point a
> `.chat` at them. They're just text — version them, diff them, share them.

## What's here

| File | Persona | Good for |
|------|---------|----------|
| `DevAssistant.md` | Expert software-engineering agent | Real work — uses tools, files, shell, and MCP; grounds answers in tool output |
| `EndlessDeath.md` | Death of the Endless (*The Sandman*) | A warm, grounded, comforting companion |
| `Gandalf.md` | Gandalf the Grey | A wise, encouraging mentor |
| `Yoda.md` | Yoda | Brief, profound, riddle-tinged guidance |
| `JackSparrow.md` | Captain Jack Sparrow | An eccentric negotiator who dodges every straight answer |
| `Deadpool.md` | Deadpool | Chaotic, fourth-wall-breaking comic relief |
| `Bender.md` | Bender (*Futurama*) | Sarcastic, gloriously unhelpful robot |
| `RickSanchez.md` | Rick Sanchez (*Rick and Morty*) | Cynical, absurd pseudo-science |

`DevAssistant.md` is the practical one; the rest are character personas — drop-in
examples to show how much a system prompt changes the experience. Copy any of
them, tweak the personality, and make it yours.

## Make DevAssistant yours

`DevAssistant.md` ends with a **Project context** slot — a single line that reads
`None set`. That's deliberate: a system prompt is fed to the model *verbatim*
(comments and all), so the example ships with **no fake project facts** the model
could mistake for real ones. Replace that line with your own — for example:

- **Stack & key libraries** — TypeScript, React, esbuild
- **Build / test** — `npm run build`, `npm test`
- **Conventions to honor** — no default exports; 4-space indent
- **Never touch** — `generated/`, `dist/`, `*.lock`

The model reads it every turn, so keep it short and high-signal.
