# AgenticWebsite

![AgenticWebsite Screenshot](src/assets/app_screenshot.png)

A sandbox app simulating a browser agent that can automate tasks like:

- Opening/closing tabs
- Navigating between tabs
- workflows (e.g. fill out a form + click submit)
- Capturing user events (e.g. clicks)
- Monitoring for simple security issues (password submit, XSS attempts, click-spamming)

This project is built with React + Vite + TypeScript.

## Getting Started

### Prerequisites

- Node.js (version 18+)
- npm

### Install dependencies + run server

```bash
npm install
npm run dev
```

### Usage

- Click +Login, +Search, or +Form in the toolbar to open new tabs.
- You can Switch between tabs and reload fixtures with the address bar.
- Click **Run Sample** to run the demo workflow.
- Watch agent events in the Agent Console and security alerts in the Security Monitor.
