# Heroku Deployment Instructions

## Method 1: Direct Git Deployment

1. **Install Heroku CLI**:
   - Download from: https://devcenter.heroku.com/articles/heroku-cli
   - Or run: `winget install Heroku.CLI`

2. **Deploy from command line**:
   ```powershell
   cd c:\GitLocal\HVP\server
   
   # Initialize git
   git init
   git add .
   git commit -m "Initial server commit"
   
   # Login and create app
   heroku login
   heroku create your-hunters-prey-server
   
   # Deploy
   git push heroku main
   
   # Your WebSocket URL will be:
   # wss://your-hunters-prey-server.herokuapp.com
   ```

## Method 2: GitHub Integration (Easier)

1. **Create GitHub Repository**:
   - Go to GitHub.com and create new repository
   - Name it: `hunters-prey-server`
   - Make it public

2. **Push server code to GitHub**:
   ```powershell
   cd c:\GitLocal\HVP\server
   git init
   git add .
   git commit -m "Initial server commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/hunters-prey-server.git
   git push -u origin main
   ```

3. **Deploy via Heroku Dashboard**:
   - Go to https://dashboard.heroku.com/
   - Click "New" → "Create new app"
   - App name: `your-hunters-prey-server`
   - Choose region
   - Click "Create app"
   
4. **Connect to GitHub**:
   - In your Heroku app dashboard
   - Go to "Deploy" tab
   - Select "GitHub" as deployment method
   - Connect to your `hunters-prey-server` repository
   - Enable "Automatic deploys" from main branch
   - Click "Deploy Branch"

5. **Your WebSocket URL**:
   ```
   wss://your-hunters-prey-server.herokuapp.com
   ```

## Method 3: Alternative Hosting (If Heroku doesn't work)

### Railway (Recommended Alternative)
1. Go to https://railway.app/
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your server repository
5. Railway will auto-detect Node.js and deploy
6. Your URL: `wss://your-app-name.up.railway.app`

### Render (Free Tier)
1. Go to https://render.com/
2. Sign up with GitHub
3. Click "New" → "Web Service"
4. Connect your GitHub repository
5. Settings:
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
6. Your URL: `wss://your-app-name.onrender.com`

## Next Steps After Deployment

1. **Update your PWA config**:
   ```javascript
   // In js/config.js
   WEBSOCKET_URL: 'wss://your-deployed-server-url.com'
   ```

2. **Test the connection**:
   - Open browser console on your PWA
   - Check for WebSocket connection logs
   - Test game creation and joining

3. **Enable HTTPS**:
   - All these platforms provide HTTPS by default
   - Required for WebSocket connections from HTTPS sites