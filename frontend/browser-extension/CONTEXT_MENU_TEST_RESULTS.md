# Context Menu Testing Results

## Test Environment
- Browser: Chrome/Edge/Firefox
- Extension Version: 0.0.0
- Test Date: 2024-01-XX

## Test Cases

### ✅ Test 1: Context Menu Appears on Text Selection
**Steps:**
1. Open test-selection.html in browser
2. Select a highlighted word (e.g., "serendipity")
3. Right-click on the selected text

**Expected Result:**
- "Remember Me" menu item appears in the context menu

**Status:** ⬜ Pass / ⬜ Fail

---

### ✅ Test 2: Save Word via Context Menu
**Steps:**
1. Select a word (e.g., "meticulous")
2. Right-click and select "Remember Me"

**Expected Result:**
- Notification appears: "This is the 1st time you forgot 'meticulous'"
- Word is saved to storage

**Status:** ⬜ Pass / ⬜ Fail

---

### ✅ Test 3: Repeated Word Save Shows Correct Count
**Steps:**
1. Select the same word again (e.g., "meticulous")
2. Right-click and select "Remember Me"

**Expected Result:**
- Notification appears: "This is the 2nd time you forgot 'meticulous'"
- Count increments correctly

**Status:** ⬜ Pass / ⬜ Fail

---

### ✅ Test 4: Context Menu Not Shown Without Selection
**Steps:**
1. Click anywhere on the page without selecting text
2. Right-click

**Expected Result:**
- "Remember Me" menu item does NOT appear

**Status:** ⬜ Pass / ⬜ Fail

---

### ✅ Test 5: Invalid Text Handling (Multiple Words)
**Steps:**
1. Select multiple words (e.g., "serendipity of discovering")
2. Right-click and select "Remember Me"

**Expected Result:**
- Error notification: "Please select a valid English word"

**Status:** ⬜ Pass / ⬜ Fail

---

### ✅ Test 6: Invalid Text Handling (Non-English)
**Steps:**
1. Select non-English text (numbers, symbols, etc.)
2. Right-click and select "Remember Me"

**Expected Result:**
- Error notification: "Please select a valid English word"

**Status:** ⬜ Pass / ⬜ Fail

---

### ✅ Test 7: Context Extraction Works
**Steps:**
1. Select a word in the middle of a sentence
2. Right-click and select "Remember Me"
3. Open the popup and check the saved word's history

**Expected Result:**
- Context sentence is correctly extracted and saved
- Word is highlighted in the context

**Status:** ⬜ Pass / ⬜ Fail

---

### ✅ Test 8: Error Handling for Unknown Words
**Steps:**
1. Select a made-up word (e.g., "xyzabc")
2. Right-click and select "Remember Me"

**Expected Result:**
- Error notification: "Error: Definition not found"

**Status:** ⬜ Pass / ⬜ Fail

---

## Manual Testing Instructions

1. Build the extension: `npm run build`
2. Load the extension in your browser:
   - Chrome: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", select `.output/chrome-mv3`
   - Firefox: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", select any file in `.output/firefox-mv2`
3. Open `test-selection.html` in the browser
4. Follow the test cases above and mark Pass/Fail for each

## Notes
- All tests should pass before marking the task as complete
- If any test fails, document the issue and fix before proceeding
