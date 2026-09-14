# Supabase & Gmail SMTP Configuration Guide for CTRL

This guide walks you through configuring **Gmail SMTP** and installing the custom **CTRL OTP & Magic Link Email Template** in your Supabase project.

---

## 1. How to Generate a Google App Password for Gmail

Gmail requires an **App Password** (a 16-character code) when connecting via SMTP:

1. Go to your **Google Account**: [https://myaccount.google.com/](https://myaccount.google.com/)
2. Navigate to **Security** (left menu).
3. Ensure **2-Step Verification** is turned **ON**.
4. Go to **App passwords**: [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   - *App name*: Enter `CTRL Recovery`
   - Click **Create**.
5. Copy the 16-character password generated (e.g. `abcd efgh ijkl mnop`).
   *(Spaces are ignored automatically by CTRL).*

---

## 2. Configure Gmail SMTP in Supabase Dashboard

To have Supabase send all authentication emails, OTPs, and magic links through your Gmail account:

1. Open your **Supabase Dashboard**: [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project: `hpvmsdrgvjcltviogreh` (or your active project).
3. Go to **Project Settings** (gear icon) -> **Authentication** (or **Authentication -> SMTP Settings**).
4. Scroll down to **SMTP Settings** and toggle **Enable Custom SMTP** to **ON**.
5. Fill in the following credentials:
   - **Sender email**: `your-email@gmail.com`
   - **Sender name**: `CTRL Autonomous Recovery`
   - **Host**: `smtp.gmail.com`
   - **Port number**: `465` *(or `587` with TLS)*
   - **Minimum TLS version**: `TLSv1.2`
   - **User**: `your-email@gmail.com`
   - **Password**: `<Paste your 16-character Google App Password>`
6. Click **Save Changes**.

---

## 3. Install the CTRL OTP Email Template in Supabase

1. In the Supabase Dashboard, go to **Authentication** -> **Email Templates**.
2. Click on **Magic Link** *(used for 6-digit OTP verification and magic links)*.
3. Configure the fields:
   - **Subject**:
     ```text
     {{ .Token }} is your CTRL verification code
     ```
   - **Body**: Open [supabase_otp_email_template.html](./supabase_otp_email_template.html), copy the entire file contents, and paste it into the **Message Body (HTML)** box.
4. Click **Save**.

*(Optional)* For the **Confirm signup** template:
1. Click on **Confirm signup**.
2. Set **Subject**: `Confirm your CTRL merchant workspace registration`.
3. Open [supabase_signup_email_template.html](./supabase_signup_email_template.html) and paste it into the **Message Body (HTML)** box.
4. Click **Save**.

---

## 4. Configure Gmail SMTP in CTRL Backend (`.env`)

To have CTRL's backend service (and `/v1/auth/send-otp` endpoint) send OTPs and customer recovery links directly via Gmail:

Update your `.env` file with:

```env
# Custom SMTP Configuration (Gmail for 100% unrestricted real OTP delivery)
SMTP_SERVICE=gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
SMTP_FROM="CTRL Autonomous Recovery <your-email@gmail.com>"
```

*(Replace `your-email@gmail.com` and `abcd efgh ijkl mnop` with your actual Gmail and App Password).*

---

## 5. Verify & Test Your Setup

You can verify your Gmail SMTP configuration in one command using CTRL's verification script:

```bash
# Test Gmail SMTP connection and dispatch a live verification code
npx tsx scripts/test_gmail_smtp.ts your-email@gmail.com
```

This will test:
1. Direct TLS/SSL handshake with `smtp.gmail.com:465`.
2. App Password authentication.
3. Delivery of a live 6-digit verification code email with CTRL styling.
