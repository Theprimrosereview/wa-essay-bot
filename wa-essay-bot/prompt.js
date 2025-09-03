function buildPrompt({ name, program, experience, strength, goals, limit = 600 }) {
  return `
You are an expert admissions essay writer.

Generate a professional but warm draft for a short personal statement for ${name}, applying to ${program}.

Here are the inputs:
• Meaningful experience: ${experience}
• Personal strength or value: ${strength}
• Academic or career goals: ${goals}

Guidelines:
- Use a clear, confident, and personal tone.
- Be concise and engaging.
- Avoid clichés.
- Stay under ${limit} words.
- Structure the essay in 2–3 paragraphs.
- Use the input details effectively.

Start the essay now.
  `.trim();
}

module.exports = { buildPrompt };
