import sys

file_path = "src/frontend/components/PhotoReviewApp.tsx"
with open(file_path, "r") as f:
    lines = f.readlines()

def print_balance():
    stack = []
    for i, line in enumerate(lines):
        if "<div" in line:
            stack.append(('div', i))
        elif "</div" in line:
            if stack and stack[-1][0] == 'div':
                stack.pop()
            else:
                print(f"Unmatched </div at line {i+1}")

        if "<> " in line or "<>" in line:
            stack.append(('Fragment', i))
        elif "</>" in line:
            if stack and stack[-1][0] == 'Fragment':
                stack.pop()
            else:
                print(f"Unmatched </> at line {i+1}")

print_balance()
