#!/bin/bash
# Script to update Cloud Run environment variables

gcloud run services update sendemail-service \
  --region=europe-west10 \
  --set-env-vars="GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/1umBp2WniijlgWG-ynZJ5q5SBkbLmQxf2DTme2uFcnbw/edit?gid=1669432275#gid=1669432275,GOOGLE_API_KEY=AIzaSyC6YigSBofS4V-SXFQfwjvjb0ccewmMFog,GMAIL_USER_EMAIL=hoanghaip2005@gmail.com,GMAIL_APP_PASSWORD=vwcdkhsmxeaqecqv,AUTH_METHOD=app-password,NODE_ENV=production,PORT=3000,TIMEZONE=Asia/Ho_Chi_Minh"