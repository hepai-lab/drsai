
# curl -v -X POST http://localhost:42601/apiv2/key/fetch_api_key \
curl -v -X POST https://aiapi001.ihep.ac.cn/apiv2/key/fetch_api_key \
     -H "Authorization: Bearer sk-***" \
     -H "Content-Type: application/json" \
     -d '{
           "username": "zdzhang@ihep.ac.cn" 
         }'