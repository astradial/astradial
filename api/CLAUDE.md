# Claude Assistant Memory

## Important Preferences and Instructions

### API Usage
- **ALWAYS use the API to create/modify PBX configurations** instead of manually editing files
- Never manually edit Asterisk configuration files - use the deployment API endpoints
- Use POST requests to create new extensions, users, trunks, etc.
- Use the deploy endpoint to trigger AMI-based reloads

### Testing Commands
- Use `npm run lint` and `npm run typecheck` if available to verify code quality
- After API deployments, verify configurations are loaded in Asterisk

### AMI Configuration
- AMI credentials: stored in .env (AMI_USER / AMI_SECRET)
- AMI service runs on localhost:5038
- Fixed ACL issues - use permit = 127.0.0.0/255.255.255.0 format

## Current Project Context
- Working on PBX API Development with multi-tenant Asterisk configuration
- AMI-based deployment reload functionality is working
- TestOrg organization ID: 2c662bff-8f80-483a-8235-74fd48965a9c