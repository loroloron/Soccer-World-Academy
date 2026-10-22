document.querySelectorAll('[data-lesson]').forEach(a=>{a.href='booking.html?type='+(a.dataset.lesson==='team'?'group':'private');});
document.querySelectorAll('[data-path]').forEach(a=>{a.href='booking.html';});
if(window.SWA_BOOKING_API){fetch(window.SWA_BOOKING_API+'/api/config').then(r=>r.ok?r.json():null).then(config=>{if(config?.bookingOpen)document.getElementById('booking-state').textContent='Online booking is open. Choose your lesson, select an available hour, and save your confirmation.';}).catch(()=>{});}
