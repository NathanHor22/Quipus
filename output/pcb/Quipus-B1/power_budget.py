"""Transparent planning calculations, not measurements or runtime promises."""
from pathlib import Path
import json

def calculate():
    capacity_mah = 2000
    usable_fraction = 0.8  # combined planning reserve; not converter efficiency
    usable_mah = capacity_mah * usable_fraction
    # Battery-side currents already include all conversion losses. Do not apply
    # another regulator-efficiency factor to these sensitivity scenarios.
    scenarios = [
        dict(battery_ma=i, recording_hours=round(usable_mah/i, 2),
             six_hour_days=round(usable_mah/i/6, 2))
        for i in [80, 120, 180, 240]
    ]
    return {
        'status': 'illustrative assumptions, unmeasured',
        'battery': {'capacity_mah': capacity_mah, 'nominal_v': 3.7,
                    'maximum_charge_v': 4.2, 'nominal_wh': 7.4,
                    'planning_usable_fraction': usable_fraction},
        'runtime_scenarios': scenarios,
        'rev_b_audio_capture_planning': {'rail_3v3_ma': 37, 'rail_3v3_mw': 122.1, 'note': 'Audio subsystem allowance including ADC, two built-in mics, clock buffer and two external mic bias branches. Not measured, not worst-case, and not added blindly to the old envelope which already included microphones.'},
        'weekly_recording_hours': [35, 42],
        'week_recording_only_max_battery_ma': [round(usable_mah/h, 2) for h in [35, 42]],
        'nominal_charge_ma': 445,
        'ideal_capacity_divided_by_charge_hours': round(capacity_mah/445, 2),
        'charge_note': 'Lower-bound capacity/current calculation only. CV tail, active load, source limit and thermal regulation extend charging.',
        'rail_capacity_check': {
            'rail_3v3_peak_budget_a': 0.85,
            'loaded_converter_input_check_v': 3.0,
            'converter_assumed_efficiency': 0.85,
            'estimated_converter_input_a': round(3.3*0.85/(3.0*0.85), 3),
            'speaker_supply_burst_allowance_a': 0.35,
            'sum_estimated_main_switch_a': round(3.3*0.85/(3.0*0.85)+0.35, 3),
            'note': 'Retained Rev A pre-layout envelope, NOT yet revised or measured for added ADC/buffer/bias loads, targeting <1.5 A through the 2 A load switch. 3.0 V is the loaded converter input, not the battery open-circuit voltage. Include charger FET, switch, shunt and harness drop. Start speaker at -6 dBFS ceiling; validate coincident Wi-Fi/SD/speaker peaks and derate at lower input voltage.'
        },
        'raw_storage': {
            'format': 'PCM16, 16 kHz, 4 separate channels',
            'bytes_per_second': 16000*2*4,
            'six_hour_decimal_gb': 16000*2*4*3600*6/1e9,
            'mono_six_hour_decimal_gb': 16000*2*3600*6/1e9,
            'fat32_4gib_four_channel_hours': round((2**32-1-44)/(16000*2*4)/3600, 2),
            'raw_32_bit_dma_bytes_per_second': 16000*4*4,
            'one_minute_decimal_mb': 16000*2*4*60/1e6,
            'note': 'Keep separate mic channels for development. Segment long recordings and preserve a meeting manifest. Classic RIFF WAV also has a 4 GiB limit; changing SD filesystem alone does not fix it.'
        }
    }

if __name__ == '__main__':
    print(json.dumps(calculate(), indent=2))
