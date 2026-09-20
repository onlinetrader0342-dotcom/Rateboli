# RateBoli 🛒

**Demand bhejein, andhi boli lagayein — sab se kam rate jeetay.**

Ek multi-user web app jismein har user **dono kaam** kar sakta hai:
1. Product ka naam aur miqdar likh kar **demand** bhejta hai — **ek saath kayi products** bhi likh sakta hai (har product ki alag demand banti hai, taake har product ka apna muqabla ho). Har product ke saath **tasveer** bhi lagayi ja sakti hai (optional, JPG/PNG/WebP/GIF, 2.5MB tak)
2. Tamam **doosre users** ko foran **notification** milti hai (app ke andar, realtime)
3. Koi bhi user doosre ki demand par apna **rate** daalta hai — koi doosre ka rate **nahi dekh sakta** (blind bidding)
4. Demand banane wale ko sirf **sab se kam rate** nazar aata hai, jeetne wale ke naam aur phone number ke saath
5. Demand **band** karne par jeetne wale ko "Mubarak" notification milti hai
6. Demand bhejte waqt **aakhri tareekh** bhi lagayi ja sakti hai — us ke baad koi boli nahi lagegi

Ek hi pabandi: **apni demand par khud boli nahi laga sakte.**

UI Roman Urdu mein hai aur mobile-friendly hai.

---

## Apne computer par chalana

1. [Node.js](https://nodejs.org) (version 20 ya upar) install karein
2. Is folder mein terminal khol kar:
   ```bash
   npm install
   npm start
   ```
3. Browser mein kholein: **http://localhost:3000**

Data `data.db` file mein save hota hai — server band karke dobara chalane par data rehta hai. Product ki tasveeren `public/uploads/` mein save hoti hain.

## Internet par lagana (taake suppliers apne phone se use kar saken)

Sab se aasaan free tareeqa — **Render.com**:

1. Ye folder GitHub par push karein
2. [render.com](https://render.com) par free account banayein → **New → Web Service** → apni repo chunein
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Disks** mein 1 GB ka persistent disk lagayein aur usay `/opt/render/project/src` ke `data.db` wale path par mount karein — warna har restart par data delete ho jayega (tasveeren `public/uploads/` mein hain, woh bhi isi disk par rehni chahiye)
5. Deploy dabayein — jo link milega (masalan `https://rateboli.onrender.com`) wohi suppliers ko de dein

(Mutabadil: kisi bhi VPS par `npm install && npm start` chalayein aur domain lagayein.)

## Zaroori notes (production se pehle)

- **Login** abhi sirf phone number se hai, **OTP/password nahi** — asli istemal se pehle SMS OTP lagana zaroori hai
- **Notifications** app ke andar realtime milti hain (jab app khuli ho). Phone ki push notification ya SMS ke liye Firebase Cloud Messaging lagana hoga — yeh Phase 2 ka kaam hai
- Rate abhi **Rs per unit** mein hai; currency future mein configurable ho sakti hai
- Koi bhi user apni boli **update** kar sakta hai jab tak demand khuli ho

## Project structure

```
server.js          → Backend (Express + Socket.io + SQLite)
public/
  index.html       → UI ka dhancha
  styles.css       → Styling (mobile-first)
  app.js           → Frontend logic (Roman Urdu)
data.db            → Database (khud ban jati hai)
```

## API (mukhtasar)

| Method | Endpoint | Kaam |
|---|---|---|
| POST | /api/register | Naya account (name, phone) — koi role chunna nahi parta |
| POST | /api/login | Phone se login |
| POST | /api/demands | Nayi demand (har user) |
| GET | /api/demands | Demands ki list (apni + doosron ki khuli) |
| POST | /api/demands/:id/bids | Boli lagana/update (apni demand par nahi) |
| POST | /api/demands/:id/close | Demand band karna (sirf demand banane wala) |
| GET/POST | /api/notifications | Notifications parhna / parha hua mark karna |
