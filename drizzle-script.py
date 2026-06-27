import pexpect
import sys

child = pexpect.spawn('/bin/bash', ['-c', 'source ~/.zshrc && pnpm run db:generate'], encoding='utf-8')
child.logfile = sys.stdout

while True:
    index = child.expect(['create column', 'rename column', 'drop column', pexpect.EOF, pexpect.TIMEOUT], timeout=30)
    if index == 0:
        child.sendline()
    elif index == 1:
        child.sendline()
    elif index == 2:
        child.sendline()
    elif index == 3:
        break
    elif index == 4:
        break
