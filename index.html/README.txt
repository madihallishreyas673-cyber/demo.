MOREA CAFE - QR table ordering website

START (on the cafe computer)
1. Install Node.js (LTS version) from https://nodejs.org  (one time only)
2. Unzip this folder. On Windows, use "Extract All".
3. Windows: double-click START-WINDOWS.bat
   Mac: right-click START-MAC.command and choose Open.
   If Mac blocks it, open Terminal in this folder and type: node server.js
4. Open http://localhost:3000 in your browser. Keep the black window open.
   If Windows Firewall asks, click "Allow" on Private networks.

PRINT THE TABLE QR CODES
1. Tap the downward shift arrow (top right), enter the code 6669.
2. Open "Table QR codes".
3. Check the address starts with your computer's Wi-Fi IP (like http://192.168.1.5:3000).
4. Scan one with a phone to test, then print all or download each one.

IMPORTANT
- In this setup, phones must be on the SAME Wi-Fi as the cafe computer.
- The computer's IP can change after a router restart, which breaks printed codes.
  Before final printing, set a fixed (reserved) IP in your router.
- To let customers use mobile data, the site must be put online on a Node.js host
  that has permanent storage (set DATA_DIR to that storage folder), using HTTPS.
  Set CHEF_PIN there to a longer code, then print new QR codes from the online site.
- A 4-digit code is fine for a trusted cafe network but weak on the public internet.
- A QR code only carries the table number. Staff should check the order matches
  a customer at that table.

CHANGE THE MENU
Edit menu.json in Notepad: names, prices, descriptions, cafe name, number of tables.
Give every item a different "id". Save, then refresh the page.

Orders are saved in data/orders.json.
