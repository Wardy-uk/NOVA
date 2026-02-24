# Azure App Registration for NOVA Dynamics 365 Integration

## What we need

A **public client** app registration in Microsoft Entra ID that allows NOVA users to sign into Dynamics 365 with their own Microsoft account (device code flow).

## Steps

### 1. Go to App Registrations

- Portal: https://portal.azure.com → search "Microsoft Entra ID" → **App registrations** (under Manage)
- Or: https://entra.microsoft.com → **Applications** → **App registrations**
- Requires **Application Administrator** or **Global Administrator** role

### 2. Create a new registration

- Click **+ New registration**
- **Name**: `NOVA Dynamics CRM`
- **Supported account types**: "Accounts in this organizational directory only" (single tenant)
- **Redirect URI**: Leave blank
- Click **Register**

### 3. Copy the IDs from the Overview page

- **Application (client) ID** — we need this
- **Directory (tenant) ID** — we need this

### 4. Enable device code flow

- Go to **Authentication** (left nav)
- Click **+ Add a platform** → select **Mobile and desktop applications**
- Check `https://login.microsoftonline.com/common/oauth2/nativeclient`
- Click **Configure**
- Scroll down to **Advanced settings**
- Set **"Allow public client flows"** → **Yes**
- Click **Save**

### 5. Add the Dynamics CRM permission

- Go to **API permissions** (left nav)
- Click **+ Add a permission**
- Select the **APIs my organization uses** tab
- Search for **"Dataverse"** (not "Dynamics CRM" — Microsoft indexes it under Dataverse)
- Select **Dataverse** → **Delegated permissions** → check **`user_impersonation`**
- Click **Add permissions**

### 6. Grant admin consent

- Back on the API permissions page, click **"Grant admin consent for [tenant name]"**
- Confirm **Yes**
- The status should show a green checkmark "Granted"

## What to send back

Once complete, send us these two values:

- **Application (client) ID**
- **Directory (tenant) ID**

No client secret is needed — this is a public client app.

## Gotchas

- Search "**Dataverse**" not "Dynamics CRM" when adding API permissions — some tenants only show it under that name
- "Allow public client flows" **must** be Yes — without it, device code login fails with a cryptic error about missing `client_secret`
- Admin consent is **required** even though users sign in interactively — `user_impersonation` can't be self-consented
