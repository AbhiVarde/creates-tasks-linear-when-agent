# creates-tasks-linear-when-agent

an agent that creates tasks in linear when I ask it to

built and deployed with [tryeve](https://tryeve.abhivarde.in), an agent runtime for [eve](https://eve.dev).

## before this works

add a model credential in this project's vercel settings, then redeploy:

```
AI_GATEWAY_API_KEY=
```

or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. one AI Gateway key covers anthropic, openai, gemini, groq, and more.

this agent also connects to a real external service, so it needs these too:

```
LINEAR_API_TOKEN=
```
