export function leftPad(template: string, insertMe: string) {
	const diff = template.length - insertMe.length;
	if (insertMe.length > template.length) return insertMe.substring(-diff);
	return template.substring(0, diff) + insertMe;
}
