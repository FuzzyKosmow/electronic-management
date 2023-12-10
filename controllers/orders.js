const Order = require('../models/order/order');
const OrderDetail = require('../models/order/orderDetail');
const Product = require('../models/product');
const mongoose = require('mongoose');
const ExpressError = require('../utils/ExpressError');
const Customer = require('../models/customer');
const Employee = require('../models/employee');
//Can query CustomerName, EmployeeName, orderDate (inside that day) , orderBeforeDate, orderAfterDate and status. Priority: orderDate > orderBeforeDate > orderAfterDate
//For name, use regex to check if it contains the name (lowercase both sides)
//For date, only one of them can be used at a time (orderDate or orderBeforeDate or orderAfterDate)
//Accepted date format: DD/MM/YYYY
//For status, use exact match
function isValidDate(dateString) {
    const regex = /^\d{2}\/\d{2}\/\d{4}$/;
    return regex.test(dateString);
}
async function  ConvertOrderQuery(query)  {
    const filter = {};
    if (query.customerName) {
        //Find customer whose name contains the query
        filter.customerId = { $in: await Customer.find({ name: { $regex: query.customerName, $options: 'i' } }).select('_id') };
    }
    if (query.employeeName) {
        //Find employee whose name contains the query
        filter.employeeId = { $in: await Employee.find({ name: { $regex: query.employeeName, $options: 'i' } }).select('_id') };
    }
    //Data send will be in DD/MM/YYYY 
    //Date type check to ensure it's in DD/MM/YYYY format
    if (query.orderAfterDate || query.orderBeforeDate || query.orderDate) {
        if (!isValidDate(query.orderAfterDate) && query.orderAfterDate) {
            throw new ExpressError('Invalid orderAfterDate format. Accepted format: DD/MM/YYYY', 400);      
          }
        if (!isValidDate(query.orderBeforeDate) && query.orderBeforeDate) {
            throw new ExpressError('Invalid orderBeforeDate format. Accepted format: DD/MM/YYYY', 400);
        }
        if (!isValidDate(query.orderDate) && query.orderDate) {
            throw new ExpressError('Invalid orderDate format. Accepted format: DD/MM/YYYY', 400);
        }

    }
    if (query.orderAfterDate) {
        const date = query.orderAfterDate;
        const [day, month, year] = date.split('/');
        filter.orderDate = { $gte: new Date(year, month - 1, day) };
    }
    if (query.orderBeforeDate) {
        const date = query.orderBeforeDate;
        const [day, month, year] = date.split('/');
        filter.orderDate = { $lt: new Date(year, month - 1, day) };
    }
    if (query.orderDate) {
        const date = query.orderDate;
        const [day, month, year] = date.split('/');
        filter.orderDate = { $gte: new Date(year, month - 1, day), $lt: new Date(year, month - 1, day + 1) };
    }
    if (query.status) {
        filter.status = query.status;
    }
    return filter;
}

module.exports.getOrders = async (req, res,next) => {
    const limit = req.query.limit;
    const startIndex = req.query.startIndex;
    let filter = {};
    let results = {};
    try {
        filter = await ConvertOrderQuery(req.query);
        results.results = await Order.find(filter).limit(limit).skip(startIndex).exec();
        res.status(200).json({ ...results, success: true });
    } catch (error) {
       next(error);
    }
}
module.exports.addOrder = async (req, res) => {
    const orderDetails = req.body.orderDetails;
    const order = new Order({
        customerId: req.body.customerId,
        employeeId: req.body.employeeId,
        orderDate: Date.now(),
        status: 'Pending',
        orderDetails: [],
        total: 0
    });``
    try {
        //Save order details
        for (const orderDetail of orderDetails) {
            const product = await Product.findById(orderDetail.productId);
            if (!product) {
                return res.status(400).json({ error: 'Product not found.' });
            }
            const newOrderDetail = new OrderDetail({
                productId: orderDetail.productId,
                quantity: orderDetail.quantity,
                sellPrice: product.sellPrice,
                orderId: order._id
            });
            await newOrderDetail.save();
            order.orderDetails.push(newOrderDetail._id);
        }
        await order.save();
        console.log("saved order");
        res.status(200).json({ msg: 'Order added', order: order });
    } catch (error) {
        next(error);
    }
}

module.exports.getOrder = async (req, res, next) => {
    try {
        const { id } = req.params;
        const order = await Order.findById(id);
        if (!order)
            return res.status(404).json({ error: 'Order not found', success: false });
        res.status(200).json({ order, success: true });
    }
    catch (error) {
        error.statusCode = 400;
        //Fail to cast id
        if (error.kind === 'ObjectId') {
            error.message = 'Invalid order id';
        }
        next(error);
    }
}
//Generally used to udpate status of order. Can also be used to update customer id, employee id , order date and order details.
module.exports.updateOrder = async (req, res) => {

    try {
        const { id } = req.params;
        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        for (const key in req.body) {
            //If order details are updated, ignore it. Handle it separately
            if (key === 'orderDetails' || key === 'deleteOrderDetails') {
                continue;
            }
            //Handle date conversion (DD/MM/YYYY)
            if (key === 'orderDate') {
                {
                    const date = req.body[key];
                    const [day, month, year] = date.split('/');
                    req.body[key] = new Date(year, month - 1, day);
                    //Remove time zone offset
                    req.body[key] = new Date(req.body[key].getTime() - req.body[key].getTimezoneOffset() * 60 * 1000);
                }
            }
            order[key] = req.body[key];
        }
        //Handle order details to delete
        if (req.body.deleteOrderDetails) {
            const ordersToDelete = [...req.body.deleteOrderDetails];
            //Delete order details
            for (const orderDetailId of ordersToDelete) {
                await mongoose.model('OrderDetail').findByIdAndDelete(orderDetailId);
                const index = order.orderDetails.indexOf(orderDetailId);
                if (index > -1) {
                    order.orderDetails.splice(index, 1);
                }
            }
        }

        //Handle order details to add
        if (req.body.newOrderDetails) {
            const newOrderDetails = [...req.body.newOrderDetails];
            for (const orderDetail of newOrderDetails) {
                //Check if product exists - > if not, ignore it. If it does, add it to order details
                const product = mongoose.model('Product').findById(orderDetail.productId);
                if (!product) {
                    continue;
                }
                const newOrderDetail = new OrderDetail({
                    productId: orderDetail.productId,
                    quantity: orderDetail.quantity,
                    sellPrice: product.sellPrice,
                    orderId: order._id
                });
                await newOrderDetail.save();
                order.orderDetails.push(newOrderDetail._id);
            }
        }
        await order.save();
        res.status(200).json({ msg: 'Order updated', order: order });
    } catch (error) {
        next(error);
    }
}

module.exports.deleteOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        await Order.findByIdAndDelete(id);
        res.json({ msg: 'Order deleted' });
    } catch (e) {
        next(error);
    }
}