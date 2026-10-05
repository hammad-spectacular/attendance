# AWS Rollback Configuration

This directory contains the configuration files needed to restore The Eye to AWS hosting.

## Architecture
- Frontend: EC2 instance at `16.16.104.177` (nginx serves static files)
- Backend API: EC2 instance at `13.63.55.73` (Node.js server)
- Database: Neon PostgreSQL (external, same connection string)

## Files

| File | Purpose |
|------|---------|
| `nginx-frontend-config` | nginx config for frontend server (16.16.104.177) |
| `nginx-backend-config` | nginx config for backend server (13.63.55.73) |
| `nginx-single-server-config` | Combined nginx config if frontend+backend on same server (13.50.106.16) |

## Deployment Steps (AWS Rollback)

1. **Frontend Server (16.16.104.177)**:
   ```bash
   # SSH to frontend server
   ssh -i the-eye-key.pem ubuntu@16.16.104.177
   
   # Install nginx
   sudo apt update && sudo apt install nginx
   
   # Copy config
   sudo cp nginx-frontend-config /etc/nginx/sites-available/theeye
   sudo ln -s /etc/nginx/sites-available/theeye /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   
   # Deploy frontend files
   sudo rsync -avz --delete public/ /var/www/html/
   ```

2. **Backend Server (13.63.55.73)**:
   ```bash
   # SSH to backend server
   ssh -i the-eye-key.pem ubuntu@13.63.55.73
   
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   
   # Clone/deploy application
   git clone <repo> /opt/theeye
   cd /opt/theeye && npm install
   
   # Copy nginx config
   sudo cp nginx-backend-config /etc/nginx/sites-available/theeye-api
   sudo ln -s /etc/nginx/sites-available/theeye-api /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   
   # Setup environment variables
   # See .env.example for required variables
   
   # Start server (use systemd or pm2)
   ```

3. **Update DNS**:
   - Point your domain to the new AWS IPs
   - Update APP_URL in .env to point to the correct frontend URL

## Environment Variables for AWS

Copy `.env` (do not commit to git) and ensure:
- `APP_URL=http://16.16.104.177` (or your domain)
- Database connection strings remain the same

## Rollback Decision Checklist

Before rolling back to AWS:
- [ ] New Render backend URL is confirmed working
- [ ] New Vercel frontend URL is confirmed working
- [ ] Database migrations are compatible with both deployments
- [ ] All functionality tested on both platforms
- [ ] DNS TTL has expired for propagation

## Security Notes

- Keep SSH keys secure (`the-eye-key.pem`)
- Use AWS Security Groups to restrict access
- Consider using AWS Certificate Manager for HTTPS
- Never commit `.env` or secrets to version control
