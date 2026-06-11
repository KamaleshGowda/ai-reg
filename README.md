# AIReg: Enterprise Data Loss Prevention for AI

AIReg is a locally executed, zero-trust browser extension that acts as a Data Loss Prevention (DLP) firewall between your employees and modern Large Language Models (LLMs). It analyzes outgoing network traffic in real-time to detect, block, or redact sensitive information—such as personally identifiable information (PII), proprietary source code, and API keys—before it ever leaves the browser.

## The Problem
As AI tools become deeply integrated into daily workflows, the risk of accidental data exposure increases exponentially. Employees often copy and paste sensitive customer data, corporate secrets, or system credentials into AI chat interfaces, permanently logging that data on third-party servers and violating compliance standards (GDPR, CCPA, HIPAA).

## The Solution
AIReg operates directly in the browser network layer to provide a seamless, non-intrusive safety net. If a user attempts to send restricted data to an AI platform, AIReg instantly intercepts the payload and provides an interactive firewall overlay, empowering the user to redact the sensitive information and continue their workflow securely.

### Key Capabilities

- **Universal Coverage:** Natively supports ChatGPT, Claude, Google Gemini, Microsoft Copilot, and Perplexity out of the box.
- **Real-Time Interception:** Synchronously pauses outgoing requests at the browser API level without adding latency to normal web traffic.
- **Automated Redaction:** Intelligently scrubs Emails, Phone Numbers, Credit Cards, and API Keys, replacing them with generic placeholders while preserving the structural integrity of complex application requests.
- **Zero Data Retention:** Operates entirely locally. AIReg does not connect to external servers, track user history, or transmit your data anywhere. 
- **Live Metrics Dashboard:** Includes a sleek, integrated Chrome Sidepanel for monitoring daily token usage, intercepted leaks, and redacted payloads.

## Getting Started

AIReg is built on Chrome's modern Manifest V3 architecture. It requires no external dependencies, no build steps, and no background node servers.

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/ai-reg.git
   ```
2. Open Google Chrome (or any Chromium browser such as Edge or Brave).
3. Navigate to `chrome://extensions/`.
4. Enable **Developer mode** via the toggle switch in the top right.
5. Click **Load unpacked** in the top left corner.
6. Select the cloned `ai-reg` directory.

The extension will activate immediately. Open your browser's Sidepanel to view the AIReg dashboard and monitor live telemetry.

## License

This project is licensed under the MIT License.
