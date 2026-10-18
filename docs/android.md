# Android

Google replaced Google Assistant with Gemini on phones in 2026, and Gemini cannot send what you say to your own
server the way a Siri shortcut can. So on Android you talk to Ask Q **through the chat**: WhatsApp or Telegram. It
understands text, **voice notes** and photos.

## Voice, hands-free

Gemini can send WhatsApp messages by voice, even with the phone locked (with "Hey Google" and Voice Match on):

> "Hey Google, send a WhatsApp to Ask Q: book padel on Saturday at 11"

For this, Ask Q must be a **contact**, so use WhatsApp in **its own number** mode (`askq setup` → WhatsApp → "Its own
number"), and save that number in your contacts as "Ask Q". The answer arrives as a WhatsApp message.

## Voice notes

Turn on voice notes in `askq setup`. Then hold the mic button in the Ask Q chat and speak. The note is transcribed on
your Ask Q machine (faster-whisper); nothing is sent to a third-party speech service.

## Telegram

Telegram works the same way and is the most reliable option (official bot API). Pin the Ask Q chat and use voice notes.
Gemini can't message Telegram bots by voice, so there you tap the mic.

## Coming later

Google is previewing *AppFunctions* (apps exposing actions to Gemini). When it opens to all developers, an Android app
could make "Hey Google, ask Ask Q…" work directly.
