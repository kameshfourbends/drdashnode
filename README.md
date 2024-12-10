# drdashnode
DRDashboard Node is used for webhook.
## Run Production
pm2 start ecosystem.config.json --env production
## Run Development
pm2 start ecosystem.config.json --env development
### OR
pm2 start ecosystem.config.json