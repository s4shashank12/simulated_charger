
# OCPP Simulated Charger

This is a simulated Electric Vehicle Charging Station (EVCS) written in TypeScript for the Deno runtime. It connects to a Central System (CMS) via a WebSocket and sends messages to simulate charging and other events.

The program then initializes some variables and connects to the WebSocket endpoint specified in the environment variable "WEBSOCKET". Once connected, it sends a sequence of messages to the CMS. It then enters an infinite delay that waits for a specified delay, dequeues a message from the queue, and sends it to the CMS.


## Supported Messages

The script creates a WebSocket client and connects to the Central System server. Once the connection is established, the script sends various messages to the server in a particular order, and waits for the server to respond. Upon receiving the response, the script validates it, and triggers the next message in the queue if the response is as expected. 

The script simulates various charger initiated OCPP messages such as

- BootNotification
- Authorize
- StartTransaction
- StopTransaction

And Remote Actions like:

- RemoteStartTransaction
- RemoteStopTransaction
## OCPP Protocol

Currently supporting only OCPP 1.6