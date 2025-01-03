export default interface InputEvent {
	type : number;
	code : number;
	value : number;
}

export const EVENT_SIZE = 24;
export const EO_TYPE = 16;
export const EO_CODE = 18;
export const EO_VALUE = 20;

export function decodeInputEvent(dataView:DataView, littleEndian:boolean) : InputEvent {
	return {
		type: dataView.getUint16(EO_TYPE, littleEndian),
		code: dataView.getUint16(EO_CODE, littleEndian),
		value: dataView.getInt32(EO_VALUE, littleEndian),
	};
}

export const EV_ABS = 3;
export const ABS_HAT0X = 16
export const ABS_HAT1X = 18
export const ABS_HAT0Y = 17
export const ABS_HAT1Y = 19
