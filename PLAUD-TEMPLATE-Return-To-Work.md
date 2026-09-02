# Plaud custom template — Return to Work Interview

Paste the block below into Plaud as a new custom template (Templates → Create → paste
into the prompt/instructions field). Name it **Return to Work Interview**.

It reproduces the Nurtur HR "Return to Work Interview" form from a recording of the
conversation, in the same order and with the same headings, so the output can be pasted
straight into the Word template or into PeopleHR.

---

## Template prompt

```
You are producing a completed "RETURN TO WORK INTERVIEW" form for Nurtur Limited from a
recording of the conversation between a line manager and an employee returning from
sickness absence.

Reproduce the form EXACTLY in the structure below. Do not add sections, do not remove
sections, do not reorder them, and do not add commentary, advice or a summary of your own.

Rules:
- Fill each field only from what was actually said in the recording.
- If something was not covered, write "Not discussed". Never guess, infer a diagnosis, or
  soften what was said.
- Write the employee's answers in plain reported form, close to their own words. Keep them
  short — a sentence or two. This is a record, not a transcript.
- For Yes/No questions, start the answer with Yes or No, then any qualifier the employee
  gave (e.g. "Yes — still a bit unwell, but ok to work").
- Where an answer is genuinely not applicable because of an earlier answer, write "N/A".
- Dates in DD/MM/YYYY. If a date was spoken relatively ("last Tuesday"), resolve it against
  the recording date and write the actual date.
- Do not record anything about the employee's health that was not said out loud in the
  meeting.
- Output as Markdown, using the exact headings and bold field labels shown below.

Output this structure:

# RETURN TO WORK INTERVIEW

*This form should be completed for all sickness absences from work.*

| | |
|---|---|
| **Employee Name** | |
| **Date of Meeting** | |
| **First date of absence** | |
| **Last day of absence** | |

## Reason for Absence

**Discuss Reasons for Absence**

**Is the employee confirming they are fit to return to work?**

**Have any suggestions been given by the GP in the Fit to Work note? (if over 7 days)**

**Does the employee consider that they have an underlying health issue?**

**If yes, how does this impact on their capability at work and/or undertaking day to day activities?**

**If there is an impact, have any reasonable adjustments been suggested and/or considered?**

## Absence Reporting

**Was correct reporting procedure followed? Yes / No**

**If not, remind employees of procedure and detail below the shortfall, and what if any further action will be taken.**

## Review of Absence Record

**How many days or periods of absence has the employee had in the past 12 months?**

**Is there a regular pattern of absence?**

**Have they reached any trigger points for review? Yes / No**

**Is there a recurring problem?**

**Any other issues?**

## Summarise agreements and next steps

---

I understand that this information will be used for the purposes of recording and monitoring sickness absence.

Signed: ............................................ (Employee)

Signed: ............................................ (Line Manager)

**Details of absence logged on PeopleHR Absence Recording and Monitoring (Yes / No):**

Date: ..........................
```

---

## Notes

- The three "Signed"/"Date" lines are left blank on purpose — they are signed on paper or
  in PeopleHR, not filled in by Plaud.
- The PeopleHR line is answered from the recording only if the manager said it out loud
  ("I'll log this on PeopleHR"); otherwise it stays blank for the manager to complete.
- If the conversation covered a long-term condition, a phased return or an adjustment,
  the wording lands in "reasonable adjustments" and in "agreements and next steps" — check
  both are consistent before sending to HR.
