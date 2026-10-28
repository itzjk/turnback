Output docs/demo.gif

Require node
Require bash

Set Shell "bash"
Set FontSize 20
Set Width 1100
Set Height 580
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set Framerate 15
Set WaitTimeout 10s

Hide
Type "source scripts/demo-setup.sh"
Enter
Wait+Screen /demo project ready/
Type "export PS1='$ '; clear"
Enter
Sleep 500ms
Show

Type "turnback watch -- node demo-agent.mjs"
Enter
Wait+Screen /agent: deleted notes.txt, created junk.txt/
Sleep 1500ms
Type "cat app.txt .env"
Enter
Sleep 1500ms
Type "turnback undo"
Enter
Wait+Screen /Run turnback redo to reapply/
Sleep 1500ms
Type "cat app.txt .env notes.txt"
Enter
Wait+Screen /do not lose this/
Sleep 2500ms
Hide
Type "turnback_demo_check restored"
Enter
Wait+Screen /demo restored: PASS/
Type "clear"
Enter
Sleep 200ms
Show
Type "turnback redo"
Enter
Wait+Screen /Run turnback undo to go back/
Sleep 1500ms
Hide
Type "turnback_demo_check broken"
Enter
Wait+Screen /demo broken: PASS/
Type "turnback_demo_clean"
Enter
Sleep 200ms
