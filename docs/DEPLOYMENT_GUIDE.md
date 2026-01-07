# V2G Deployment Guide

## Quick Deployment Steps

### Step 1: Deploy Database Schema to Supabase

1. Go to your Supabase project: https://supabase.com/dashboard/project/xlgngjtwvvrjolaxjgan

2. Navigate to **SQL Editor** (left sidebar)

3. Create a new query and paste the contents of:
   ```
   supabase/migrations/20241229_init_v2g_schema.sql
   ```

4. Click **Run** to execute the migration

5. Verify tables are created by going to **Table Editor**:
   - `devices`
   - `user_preferences`
   - `decision_logs`
   - `contributions`
   - `price_cache`

---

### Step 2: Enable Google OAuth in Supabase

1. Go to **Authentication** → **Providers**

2. Find **Google** and enable it

3. You need to configure Google OAuth:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Go to **APIs & Services** → **Credentials**
   - Create **OAuth 2.0 Client ID** (Web Application)
   - Add authorized redirect URI:
     ```
     https://xlgngjtwvvrjolaxjgan.supabase.co/auth/v1/callback
     ```
   - Copy the **Client ID** and **Client Secret**

4. Back in Supabase, paste the Client ID and Secret

5. Save the configuration

---

### Step 3: Deploy to Vercel

#### Option A: Deploy via Vercel CLI

```bash
cd v2g-app

# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Follow prompts, select defaults
# When asked about environment variables, say yes
```

#### Option B: Deploy via GitHub

1. Push your code to GitHub:
   ```bash
   cd v2g-app
   git init
   git add .
   git commit -m "Initial V2G deployment"
   git remote add origin https://github.com/YOUR_USERNAME/v2g-app.git
   git push -u origin main
   ```

2. Go to [Vercel](https://vercel.com) and click **Add New Project**

3. Import your GitHub repository

4. Configure environment variables (see below)

5. Click **Deploy**

---

### Step 4: Configure Environment Variables in Vercel

Add these in **Project Settings** → **Environment Variables**:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xlgngjtwvvrjolaxjgan.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (your anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (your service key) |
| `ELECTRICITY_MAPS_API_KEY` | `your-electricitymaps-api-key` |
| `ELECTRICITY_MAPS_ZONE` | `IN-SO` |

---

### Step 5: Update Supabase Redirect URLs

After deploying to Vercel, you'll get a URL like `https://v2g-app.vercel.app`

1. Go to Supabase **Authentication** → **URL Configuration**

2. Update:
   - **Site URL**: `https://v2g-app.vercel.app`
   - **Redirect URLs**: Add `https://v2g-app.vercel.app/**`

3. Also update Google OAuth authorized redirect URI:
   - Add `https://v2g-app.vercel.app/dashboard` to Google Console

---

### Step 6: Test the Deployment

1. Visit your Vercel URL
2. Click **Get Started** → **Continue with Google**
3. Sign in with your Google account
4. You should be redirected to the Dashboard
5. Go to **Settings** and test saving preferences

---

## Troubleshooting

### "Invalid redirect" error after Google sign-in
- Make sure Vercel URL is added to Supabase redirect URLs
- Make sure Google OAuth has the correct redirect URI

### Dashboard shows loading forever
- Check browser console for errors
- Verify environment variables are set in Vercel

### Preferences not saving
- Run the database migration in Supabase SQL Editor
- Check RLS policies are created

---

## What's Working After Deployment

✅ Google Sign-in/Sign-out
✅ Dashboard with mock data
✅ Device management page
✅ Settings page (save/load preferences)
✅ Price API (IEX dataset + Electricity Maps)
✅ Grid stress API
✅ Decision API (ML-based)
✅ Telemetry API (for devices)

---

## What Needs Manual Testing with Real Hardware

⏳ ESP32 device registration
⏳ Real BMS telemetry
⏳ Blockchain token rewards
⏳ Real-time dashboard updates
