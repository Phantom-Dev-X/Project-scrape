# Project Scrape — Free SMS Numbers Telegram Bot

This JavaScript project scrapes temporary phone-number listings and provides them through a Telegram bot for SMS-verification workflows.

## Features

- Free temporary phone numbers from supported countries
- Recent SMS message listings
- On-demand number refresh
- Telegram command interface
- Deployable as a background worker

## Technologies

- JavaScript
- Node.js
- Telegram Bot API
- Environment variables

## Setup

```bash
npm install
cp .env.example .env
```

Add `BOT_TOKEN` to `.env`, then start the bot:

```bash
node bot.js
```

## Commands

- `/start` — Open the main menu
- `/stats` — Display statistics
- `/refresh` — Reload available data
- `/post` — Post results to a configured channel

## Responsible Use

Use this project only for services and accounts you own or are authorized to access. Temporary numbers must not be used for fraud, abuse, or unauthorized account access.
