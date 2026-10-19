#!/usr/bin/env python3
"""Builds the Ask Q Siri shortcut (unsigned) as shortcut/Ask Q.unsigned.shortcut.

When you install it, it asks for your Ask Q URL and token (import questions), so the published file holds no secrets.
iOS only imports signed shortcuts: sign it on a Mac with
    shortcuts sign --mode anyone --input "shortcut/Ask Q.unsigned.shortcut" --output "shortcut/Ask Q.shortcut"

How it works (the same loop as the author's own shortcut): Siri says the last answer and listens (Ask for Input) →
POST {text} to your Ask Q → the answer becomes the next prompt. To finish, say "stop" or just don't answer.
"""
import os
import plistlib
import uuid

def uid():
    return str(uuid.uuid4()).upper()

def out(action_uuid, name):
    return {'OutputUUID': action_uuid, 'Type': 'ActionOutput', 'OutputName': name}

def attachment(value):
    return {'Value': value, 'WFSerializationType': 'WFTextTokenAttachment'}

def tokens(text, refs):
    """A text with variables: each '￼' in text is replaced, in order, by one of refs."""
    ranges, i = {}, 0
    for pos, ch in enumerate(text):
        if ch == '￼':
            ranges[f'{{{pos}, 1}}'] = refs[i]
            i += 1
    return {'Value': {'string': text, 'attachmentsByRange': ranges}, 'WFSerializationType': 'WFTextTokenString'}

def plain(text):
    return {'Value': {'string': text}, 'WFSerializationType': 'WFTextTokenString'}

def action(ident, **params):
    return {'WFWorkflowActionIdentifier': f'is.workflow.actions.{ident}', 'WFWorkflowActionParameters': params}

TOKEN, HELLO, ASK, FETCH = uid(), uid(), uid(), uid()
LOOP = uid()
answer = {'VariableName': 'Answer', 'Type': 'Variable'}

actions = [
    # 0: the token (filled in by the import question)
    action('gettext', UUID=TOKEN, WFTextActionText=''),
    action('gettext', UUID=HELLO, WFTextActionText="I'm listening"),
    action('setvariable', WFVariableName='Answer', WFInput=attachment(out(HELLO, 'Text'))),
    action('repeat.count', GroupingIdentifier=LOOP, WFControlFlowMode=0, WFRepeatCount=20.0),
    # Siri says the last answer and listens
    action('ask', UUID=ASK, WFAskActionPrompt=tokens('￼', [answer])),
    # 5: the URL (filled in by the import question)
    action('downloadurl', UUID=FETCH, WFURL='', WFHTTPMethod='POST', ShowHeaders=True, WFHTTPBodyType='JSON',
           WFHTTPHeaders={'Value': {'WFDictionaryFieldValueItems': [
               {'WFItemType': 0, 'WFKey': plain('Authorization'), 'WFValue': tokens('Bearer ￼', [out(TOKEN, 'Text')])}]},
               'WFSerializationType': 'WFDictionaryFieldValue'},
           WFJSONValues={'Value': {'WFDictionaryFieldValueItems': [
               {'WFItemType': 0, 'WFKey': plain('text'), 'WFValue': tokens('￼', [out(ASK, 'Provided Input')])}]},
               'WFSerializationType': 'WFDictionaryFieldValue'}),
    action('setvariable', WFVariableName='Answer', WFInput=attachment(out(FETCH, 'Contents of URL'))),
    action('repeat.count', GroupingIdentifier=LOOP, WFControlFlowMode=2),
]

shortcut = {
    'WFWorkflowActions': actions,
    'WFWorkflowImportQuestions': [
        {'ActionIndex': 0, 'Category': 'Parameter', 'ParameterKey': 'WFTextActionText', 'DefaultValue': '',
         'Text': 'Your Ask Q token. On your Ask Q machine run: askq token --qr (scan it) or askq token --show'},
        {'ActionIndex': 5, 'Category': 'Parameter', 'ParameterKey': 'WFURL', 'DefaultValue': 'https://',
         'Text': 'Your Ask Q URL, shown at the end of askq setup (like https://my-server.tail1234.ts.net/ask)'},
    ],
    'WFWorkflowClientVersion': '4610',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': -1263359489, 'WFWorkflowIconGlyphNumber': 61440},
    'WFWorkflowTypes': ['Watch', 'WFWorkflowTypeShowInSearch'],
    'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowHasOutputFallback': False,
    'WFWorkflowHasShortcutInputVariables': False,
    'WFQuickActionSurfaces': [],
}

dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Ask Q.unsigned.shortcut')
with open(dest, 'wb') as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
print(dest)
