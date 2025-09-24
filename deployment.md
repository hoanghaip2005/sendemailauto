# build cloudrun docker image
# add linux/amd64 for cloudrun
docker buildx build \
  --platform linux/amd64 \
  -t europe-west10-docker.pkg.dev/thermal-highway-470815-u4/sendemail/sendemail:v2 \
  --push .

# test image local
docker run --rm \
  --name sendemail-local \
  -p 8080:8080 \
  -e PORT=8080 \
  -e NODE_ENV=production \
  europe-west10-docker.pkg.dev/thermal-highway-470815-u4/sendemail/sendemail:v2

# deploy
gcloud run services replace cloudrun_deployment.yml --region=europe-west10