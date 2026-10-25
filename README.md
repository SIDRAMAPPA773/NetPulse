# NetPulse 🌐
### Enterprise Network Monitoring & Observability NOC Dashboard

NetPulse is an enterprise-grade Network Operations Center (NOC) platform providing real-time hardware telemetry, automated incident detection, interactive topology mapping, and bandwidth flow analytics.

---

## ✨ Features

- **Live Fleet Telemetry**: Real-time ICMP ping probing & SNMPv2 metrics (Latency, Packet Loss, CPU, Memory).
- **Dual Telemetry Modes**:
  - **Real Hardware Probing**: Dispatches live ICMP echo packets and SNMP queries across your network interfaces.
  - **Virtual Simulation Mode**: Synthesizes realistic randomized network variations for testing and demonstrations.
- **Dynamic Network Topology**: Interactive visual node graph mapping uplinks, core routers, switches, and endpoints.
- **Automated Incident Response**: Threshold-based alert triggers (Critical, High, Medium, Low) with Ack & Resolve workflows.
- **Bandwidth & Flow Analytics**: Comparative RX (inbound) and TX (outbound) throughput charts.
- **Diagnostics & Audit Reports**: Instant client-side CSV and JSON export for compliance and post-mortems.
- **Modern UI**: High-contrast, responsive interface built with Tailwind CSS, React, and Lucide icons.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, Lucide React, Recharts, @xyflow/react, Socket.io-client
- **Backend**: Node.js, Express.js, MongoDB / Mongoose, Socket.io, node-cron
- **Protocols & Libraries**: ICMP (`ping`), SNMP (`net-snmp`, `snmp-native`), WebSockets

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB (running locally or MongoDB Atlas)

### 1. Backend Setup
```bash
cd server
npm install
cp .env.example .env
# Seed default demo devices and admin user:
node seed.js
# Start server:
npm start
```
*Backend runs on `http://localhost:5000`*

### 2. Frontend Setup
```bash
cd client
npm install
npm run dev
```
*Frontend runs on `http://localhost:5173`*

---

## 🔑 Default Credentials
- **Email:** `admin@college.edu`
- **Password:** `password123`

---

## 📄 License
ISC
